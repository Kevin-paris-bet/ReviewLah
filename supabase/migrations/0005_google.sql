-- ReviewLah — migration 0005: Google Business Profile (connection, linked listings, imported
-- reviews, reply drafts). Everything here stays unused until GBP_ENABLED=true in the app.
-- Idempotent.
--
-- Data kept: the encrypted OAuth refresh token of the connected Google account, which listing is
-- linked to which location, and the reviews of linked listings (reviewer display name, rating,
-- text, dates, the business's reply). Nothing else is read from Google.
-- "Disconnect Google and delete data" removes all of it (google_delete_data).

begin;

-- ------------------------------------------------------------
-- Tables
-- ------------------------------------------------------------

-- One connected Google account per customer. Tokens are encrypted by the app (AES-256-GCM, key in
-- the TOKEN_ENCRYPTION_KEY environment variable) before they reach the database, and this table
-- is not readable through the API at all: server-side (service role) only.
create table if not exists public.google_connections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.companies (id) on delete cascade,
  account_label text,
  refresh_token_enc text not null,
  access_token_enc text,
  access_token_expires_at timestamptz,
  scope text,
  status text not null default 'active' check (status in ('active', 'revoked')),
  last_error text,
  connected_by uuid references auth.users (id) on delete set null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Which Google listing belongs to which of our locations (chosen by the owner).
create table if not exists public.google_locations (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  connection_id uuid not null references public.google_connections (id) on delete cascade,
  account_name text not null,
  location_name text not null,
  title text,
  address text,
  place_id text,
  average_rating numeric(3, 2),
  total_review_count integer,
  last_synced_at timestamptz,
  sync_error text,
  linked_at timestamptz not null default now(),
  unique (account_name, location_name)
);
create index if not exists google_locations_connection_idx on public.google_locations (connection_id);

create table if not exists public.google_reviews (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  review_id text not null,
  resource_name text not null,
  reviewer_name text,
  rating smallint check (rating between 1 and 5),
  comment text,
  create_time timestamptz,
  update_time timestamptz,
  reply_comment text,
  reply_update_time timestamptz,
  first_seen_at timestamptz not null default now(),
  alerted_at timestamptz,
  unique (business_id, review_id)
);
create index if not exists google_reviews_business_time_idx on public.google_reviews (business_id, create_time desc);

-- At most one reply draft per review. A draft is never published by itself: the owner edits and
-- approves it, and only then the app sends it to Google.
create table if not exists public.review_reply_drafts (
  review_id uuid primary key references public.google_reviews (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  language text not null default 'en' check (language in ('en', 'ms', 'zh')),
  body text not null,
  source text not null default 'manual' check (source in ('ai', 'manual')),
  model text,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

alter table public.google_connections enable row level security; -- no policy: service role only
alter table public.google_locations enable row level security;
alter table public.google_reviews enable row level security;
alter table public.review_reply_drafts enable row level security;

revoke all on public.google_connections, public.google_locations, public.google_reviews, public.review_reply_drafts from anon, authenticated;
grant select on public.google_locations, public.google_reviews, public.review_reply_drafts to authenticated;
grant all on public.google_connections, public.google_locations, public.google_reviews, public.review_reply_drafts to service_role;
revoke truncate, references, trigger on public.google_connections, public.google_locations, public.google_reviews, public.review_reply_drafts from anon, authenticated;

drop policy if exists google_locations_select on public.google_locations;
create policy google_locations_select on public.google_locations for select
  using (public.is_admin() or public.owns_business(business_id));

-- Reviews and drafts are part of Pro, like the other detailed data.
drop policy if exists google_reviews_select on public.google_reviews;
create policy google_reviews_select on public.google_reviews for select
  using (public.is_admin() or (public.owns_business(business_id) and public.business_is_pro(business_id)));
drop policy if exists review_reply_drafts_select on public.review_reply_drafts;
create policy review_reply_drafts_select on public.review_reply_drafts for select
  using (public.is_admin() or (public.owns_business(business_id) and public.business_is_pro(business_id)));

drop trigger if exists google_connections_touch on public.google_connections;
create trigger google_connections_touch before update on public.google_connections
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- What the owner can read and do
-- ------------------------------------------------------------

-- Connection state for the signed-in owner. Never returns a token.
create or replace function public.google_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'connections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'company_id', c.id, 'status', g.status, 'account_label', g.account_label,
        'connected_at', g.connected_at, 'last_error', g.last_error) order by g.connected_at)
        from public.companies c
        join public.google_connections g on g.company_id = c.id
       where c.owner_id = auth.uid()), '[]'::jsonb),
    'locations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'business_id', l.business_id, 'title', l.title, 'address', l.address,
        'account_name', l.account_name, 'location_name', l.location_name,
        'average_rating', l.average_rating, 'total_review_count', l.total_review_count,
        'last_synced_at', l.last_synced_at, 'sync_error', l.sync_error, 'linked_at', l.linked_at) order by l.linked_at)
        from public.google_locations l
        join public.businesses b on b.id = l.business_id
        join public.companies c on c.id = b.company_id
       where c.owner_id = auth.uid()), '[]'::jsonb)
  );
$$;
revoke all on function public.google_status() from public, anon;
grant execute on function public.google_status() to authenticated;

-- Reviews of one location with their draft, newest first.
-- p_filter: 'all' | 'unreplied' | 'replied' | 'low' (1 to 3 stars).
create or replace function public.review_inbox(p_business_id uuid, p_filter text default 'all', p_limit int default 20, p_offset int default 0)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_filter text := case when p_filter in ('unreplied', 'replied', 'low') then p_filter else 'all' end;
  v_result jsonb;
begin
  if not (public.is_admin() or public.owns_business(p_business_id)) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if not (public.is_admin() or public.business_is_pro(p_business_id)) then
    raise exception 'pro_required' using errcode = 'P0001';
  end if;
  with mine as materialized (
    select r.* from public.google_reviews r where r.business_id = p_business_id
  ),
  picked as (
    select * from mine m
     where v_filter = 'all'
        or (v_filter = 'unreplied' and m.reply_comment is null)
        or (v_filter = 'replied' and m.reply_comment is not null)
        or (v_filter = 'low' and m.rating <= 3)
  )
  select jsonb_build_object(
    'filter', v_filter,
    'total', (select count(*) from mine),
    'unreplied', (select count(*) from mine where reply_comment is null),
    'low', (select count(*) from mine where rating <= 3),
    'average', (select round(avg(rating), 2) from mine where rating is not null),
    'by_rating', (select jsonb_agg(coalesce(a.n, 0) order by g.s)
                    from generate_series(1, 5) as g(s)
                    left join (select rating, count(*) as n from mine group by rating) a on a.rating = g.s),
    'matching', (select count(*) from picked),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.create_time desc nulls last) from (
        select p.id, p.reviewer_name, p.rating, p.comment, p.create_time, p.update_time,
               p.reply_comment, p.reply_update_time,
               (select jsonb_build_object('body', d.body, 'language', d.language, 'source', d.source, 'updated_at', d.updated_at)
                  from public.review_reply_drafts d where d.review_id = p.id) as draft
          from picked p
         order by p.create_time desc nulls last
         limit least(greatest(coalesce(p_limit, 20), 1), 50) offset greatest(coalesce(p_offset, 0), 0)) x), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.review_inbox(uuid, text, int, int) from public, anon;
grant execute on function public.review_inbox(uuid, text, int, int) to authenticated;

create or replace function public.save_reply_draft(p_review_id uuid, p_body text, p_language text default 'en', p_source text default 'manual', p_model text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_business uuid;
  v_body text := trim(coalesce(p_body, ''));
begin
  select business_id into v_business from public.google_reviews where id = p_review_id;
  if v_business is null or not (public.is_admin() or public.owns_business(v_business)) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if not (public.is_admin() or public.business_is_pro(v_business)) then
    raise exception 'pro_required' using errcode = 'P0001';
  end if;
  if length(v_body) < 1 then
    raise exception 'reply_empty' using errcode = 'P0001';
  end if;
  if length(v_body) > 4000 then
    raise exception 'reply_long' using errcode = 'P0001';
  end if;
  insert into public.review_reply_drafts (review_id, business_id, language, body, source, model, updated_by, updated_at)
  values (p_review_id, v_business,
          case when p_language in ('en', 'ms', 'zh') then p_language else 'en' end,
          v_body, case when p_source = 'ai' then 'ai' else 'manual' end, left(p_model, 80), auth.uid(), now())
  on conflict (review_id) do update
    set language = excluded.language, body = excluded.body, source = excluded.source,
        model = excluded.model, updated_by = excluded.updated_by, updated_at = now();
end;
$$;
revoke all on function public.save_reply_draft(uuid, text, text, text, text) from public, anon;
grant execute on function public.save_reply_draft(uuid, text, text, text, text) to authenticated, service_role;

create or replace function public.discard_reply_draft(p_review_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_business uuid;
begin
  select business_id into v_business from public.google_reviews where id = p_review_id;
  if v_business is null or not (public.is_admin() or public.owns_business(v_business)) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  delete from public.review_reply_drafts where review_id = p_review_id;
end;
$$;
revoke all on function public.discard_reply_draft(uuid) from public, anon;
grant execute on function public.discard_reply_draft(uuid) to authenticated;

-- Unlinks one listing and deletes its imported reviews and drafts.
create or replace function public.google_unlink_location(p_business_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.owns_business(p_business_id) or coalesce(auth.jwt() ->> 'role', '') = 'service_role') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  delete from public.google_reviews where business_id = p_business_id;
  delete from public.google_locations where business_id = p_business_id;
  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (auth.uid(), 'google.unlinked', 'business', p_business_id);
end;
$$;
revoke all on function public.google_unlink_location(uuid) from public, anon;
grant execute on function public.google_unlink_location(uuid) to authenticated, service_role;

-- "Disconnect Google and delete data": removes the stored tokens, every linked listing and every
-- imported review and draft of this customer. The app revokes the token at Google first.
create or replace function public.google_delete_data(p_company_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_reviews int;
  v_locations int;
  v_connections int;
begin
  if not (public.is_admin() or public.owns_company(p_company_id) or coalesce(auth.jwt() ->> 'role', '') = 'service_role') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  delete from public.google_reviews r using public.businesses b
   where r.business_id = b.id and b.company_id = p_company_id;
  get diagnostics v_reviews = row_count;
  delete from public.google_locations l using public.businesses b
   where l.business_id = b.id and b.company_id = p_company_id;
  get diagnostics v_locations = row_count;
  delete from public.google_connections where company_id = p_company_id;
  get diagnostics v_connections = row_count;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'google.disconnected', 'company', p_company_id,
          jsonb_build_object('reviews', v_reviews, 'locations', v_locations));
  return jsonb_build_object('reviews', v_reviews, 'locations', v_locations, 'connections', v_connections);
end;
$$;
revoke all on function public.google_delete_data(uuid) from public, anon;
grant execute on function public.google_delete_data(uuid) to authenticated, service_role;

-- ------------------------------------------------------------
-- Server side only (service role): connection, linking, review import
-- ------------------------------------------------------------

create or replace function public.google_save_connection(
  p_company_id uuid, p_user_id uuid, p_account_label text, p_refresh_token_enc text, p_scope text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  insert into public.google_connections (company_id, account_label, refresh_token_enc, scope, status, connected_by, connected_at)
  values (p_company_id, left(p_account_label, 200), p_refresh_token_enc, p_scope, 'active', p_user_id, now())
  on conflict (company_id) do update
    set account_label = excluded.account_label, refresh_token_enc = excluded.refresh_token_enc,
        access_token_enc = null, access_token_expires_at = null, scope = excluded.scope,
        status = 'active', last_error = null, connected_by = excluded.connected_by, connected_at = now()
  returning id into v_id;
  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (p_user_id, 'google.connected', 'company', p_company_id);
  return v_id;
end;
$$;
revoke all on function public.google_save_connection(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.google_save_connection(uuid, uuid, text, text, text) to service_role;

-- Links a Google listing to one of the customer's locations. Linking another listing to the same
-- location replaces the previous one and removes its imported reviews.
create or replace function public.google_link_location(
  p_business_id uuid, p_account_name text, p_location_name text, p_title text, p_address text, p_place_id text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_connection uuid;
  v_existing public.google_locations;
begin
  select g.id into v_connection
    from public.businesses b
    join public.google_connections g on g.company_id = b.company_id
   where b.id = p_business_id and g.status = 'active';
  if v_connection is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if p_account_name !~ '^accounts/[0-9A-Za-z_-]+$' or p_location_name !~ '^locations/[0-9A-Za-z_-]+$' then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  select * into v_existing from public.google_locations where business_id = p_business_id;
  if v_existing.business_id is not null
     and (v_existing.account_name <> p_account_name or v_existing.location_name <> p_location_name) then
    delete from public.google_reviews where business_id = p_business_id;
  end if;
  -- A listing can feed one location only.
  delete from public.google_reviews r using public.google_locations l
   where l.account_name = p_account_name and l.location_name = p_location_name
     and l.business_id <> p_business_id and r.business_id = l.business_id;
  delete from public.google_locations
   where account_name = p_account_name and location_name = p_location_name and business_id <> p_business_id;
  insert into public.google_locations (business_id, connection_id, account_name, location_name, title, address, place_id)
  values (p_business_id, v_connection, p_account_name, p_location_name, left(p_title, 200), left(p_address, 300), left(p_place_id, 200))
  on conflict (business_id) do update
    set connection_id = excluded.connection_id, account_name = excluded.account_name,
        location_name = excluded.location_name, title = excluded.title, address = excluded.address,
        place_id = excluded.place_id, sync_error = null, linked_at = now(),
        last_synced_at = case when public.google_locations.account_name = excluded.account_name
                               and public.google_locations.location_name = excluded.location_name
                              then public.google_locations.last_synced_at end;
  insert into public.audit_log (action, entity, entity_id, detail)
  values ('google.linked', 'business', p_business_id, jsonb_build_object('title', p_title));
end;
$$;
revoke all on function public.google_link_location(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.google_link_location(uuid, text, text, text, text, text) to service_role;

-- Stores a page of reviews read from Google. Returns the reviews that were not known before
-- (used for the new-review alert). With p_complete, reviews that Google no longer returns are
-- removed here too.
-- p_reviews: [{ review_id, resource_name, reviewer_name, rating, comment, create_time, update_time,
--               reply_comment, reply_update_time }]
create or replace function public.google_upsert_reviews(
  p_business_id uuid, p_reviews jsonb, p_complete boolean default false, p_average numeric default null, p_total int default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_new jsonb;
begin
  if not exists (select 1 from public.google_locations where business_id = p_business_id) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  with incoming as (
    select x.review_id, x.resource_name, left(x.reviewer_name, 200) as reviewer_name,
           case when x.rating between 1 and 5 then x.rating end as rating,
           x.comment, x.create_time, x.update_time, x.reply_comment, x.reply_update_time
      from jsonb_to_recordset(coalesce(p_reviews, '[]'::jsonb)) as x(
        review_id text, resource_name text, reviewer_name text, rating smallint, comment text,
        create_time timestamptz, update_time timestamptz, reply_comment text, reply_update_time timestamptz)
     where x.review_id is not null and x.resource_name is not null
  ),
  upserted as (
    insert into public.google_reviews as r (
      business_id, review_id, resource_name, reviewer_name, rating, comment, create_time, update_time,
      reply_comment, reply_update_time)
    select p_business_id, i.review_id, i.resource_name, i.reviewer_name, i.rating, i.comment, i.create_time,
           i.update_time, i.reply_comment, i.reply_update_time
      from incoming i
    on conflict (business_id, review_id) do update
      set resource_name = excluded.resource_name, reviewer_name = excluded.reviewer_name,
          rating = excluded.rating, comment = excluded.comment, create_time = excluded.create_time,
          update_time = excluded.update_time, reply_comment = excluded.reply_comment,
          reply_update_time = excluded.reply_update_time
    returning r.id, r.review_id, r.reviewer_name, r.rating, r.comment, r.create_time, (xmax = 0) as inserted
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', u.id, 'review_id', u.review_id, 'reviewer_name', u.reviewer_name, 'rating', u.rating,
           'comment', u.comment, 'create_time', u.create_time) order by u.create_time desc)
         filter (where u.inserted), '[]'::jsonb)
    into v_new from upserted u;

  if coalesce(p_complete, false) then
    delete from public.google_reviews r
     where r.business_id = p_business_id
       and r.review_id not in (
         select x.review_id from jsonb_to_recordset(coalesce(p_reviews, '[]'::jsonb)) as x(review_id text) where x.review_id is not null);
  end if;

  update public.google_locations
     set last_synced_at = now(), sync_error = null,
         average_rating = coalesce(p_average, average_rating),
         total_review_count = coalesce(p_total, total_review_count)
   where business_id = p_business_id;
  return v_new;
end;
$$;
revoke all on function public.google_upsert_reviews(uuid, jsonb, boolean, numeric, int) from public, anon, authenticated;
grant execute on function public.google_upsert_reviews(uuid, jsonb, boolean, numeric, int) to service_role;

-- After the owner approved a reply and Google accepted it (or after a reply was removed).
create or replace function public.google_set_reply(p_review_id uuid, p_comment text, p_time timestamptz, p_actor uuid default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_business uuid;
begin
  update public.google_reviews
     set reply_comment = p_comment, reply_update_time = case when p_comment is null then null else coalesce(p_time, now()) end
   where id = p_review_id
  returning business_id into v_business;
  if v_business is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  delete from public.review_reply_drafts where review_id = p_review_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (p_actor, case when p_comment is null then 'review.reply_deleted' else 'review.reply_published' end,
          'business', v_business, jsonb_build_object('review', p_review_id));
end;
$$;
revoke all on function public.google_set_reply(uuid, text, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.google_set_reply(uuid, text, timestamptz, uuid) to service_role;

-- Connections to refresh, with their linked listings whose location is Pro.
create or replace function public.google_sync_targets(p_company_id uuid default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'connection_id', g.id, 'company_id', g.company_id,
    'refresh_token_enc', g.refresh_token_enc, 'access_token_enc', g.access_token_enc,
    'access_token_expires_at', g.access_token_expires_at,
    'owner_email', c.owner_email, 'email_review_alerts', c.email_review_alerts,
    'locations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'business_id', l.business_id, 'business_name', b.name, 'account_name', l.account_name,
        'location_name', l.location_name, 'last_synced_at', l.last_synced_at) order by l.last_synced_at nulls first)
        from public.google_locations l
        join public.businesses b on b.id = l.business_id
       where l.connection_id = g.id and public.business_is_pro(l.business_id)), '[]'::jsonb)
  ) order by g.connected_at), '[]'::jsonb)
    from public.google_connections g
    join public.companies c on c.id = g.company_id
   where g.status = 'active' and (p_company_id is null or g.company_id = p_company_id);
$$;
revoke all on function public.google_sync_targets(uuid) from public, anon, authenticated;
grant execute on function public.google_sync_targets(uuid) to service_role;

-- Review trends for the monthly email: { "<business_id>": { ... } } for linked Pro locations.
create or replace function public.monthly_review_data(p_month date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz constant text := 'Asia/Kuala_Lumpur';
  v_month date := date_trunc('month', p_month::timestamp)::date;
  v_from timestamptz := (v_month::timestamp) at time zone v_tz;
  v_to timestamptz := ((v_month + interval '1 month')::timestamp) at time zone v_tz;
  v_prev_from timestamptz := ((v_month - interval '1 month')::timestamp) at time zone v_tz;
  v_result jsonb;
begin
  select coalesce(jsonb_object_agg(l.business_id::text, jsonb_build_object(
    'new_reviews', (select count(*) from public.google_reviews r where r.business_id = l.business_id and r.create_time >= v_from and r.create_time < v_to),
    'prev_new_reviews', (select count(*) from public.google_reviews r where r.business_id = l.business_id and r.create_time >= v_prev_from and r.create_time < v_from),
    'avg_rating', (select round(avg(r.rating), 2) from public.google_reviews r where r.business_id = l.business_id and r.create_time >= v_from and r.create_time < v_to),
    'prev_avg_rating', (select round(avg(r.rating), 2) from public.google_reviews r where r.business_id = l.business_id and r.create_time >= v_prev_from and r.create_time < v_from),
    'low_ratings', (select count(*) from public.google_reviews r where r.business_id = l.business_id and r.create_time >= v_from and r.create_time < v_to and r.rating <= 2),
    'unreplied', (select count(*) from public.google_reviews r where r.business_id = l.business_id and r.reply_comment is null),
    'total_reviews', (select count(*) from public.google_reviews r where r.business_id = l.business_id),
    'avg_all', (select round(avg(r.rating), 2) from public.google_reviews r where r.business_id = l.business_id)
  )), '{}'::jsonb)
  into v_result
  from public.google_locations l
  where public.business_is_pro(l.business_id);
  return v_result;
end;
$$;
revoke all on function public.monthly_review_data(date) from public, anon, authenticated;
grant execute on function public.monthly_review_data(date) to service_role;

-- Daily clean-up: Google data of a location that has not been Pro for 30 days is deleted
-- (the listing is unlinked and its imported reviews and drafts are removed).
create or replace function public.google_maintenance() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[];
begin
  select coalesce(array_agg(l.business_id), '{}') into v_ids
    from public.google_locations l
   where not public.business_is_pro(l.business_id)
     and l.linked_at < now() - interval '30 days'
     and not exists (
       select 1 from public.subscriptions s
        where s.business_id = l.business_id
          and coalesce(s.ended_at, s.current_period_end, s.updated_at) > now() - interval '30 days');
  delete from public.google_reviews where business_id = any(v_ids);
  delete from public.google_locations where business_id = any(v_ids);
  return jsonb_build_object('unlinked_locations', coalesce(array_length(v_ids, 1), 0));
end;
$$;
revoke all on function public.google_maintenance() from public, anon, authenticated;
grant execute on function public.google_maintenance() to service_role;

notify pgrst, 'reload schema';

commit;
