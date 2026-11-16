-- ReviewLah — migration 0003: what the business owner can change themselves
-- (Google review link, plate labels, location details, account), the Pro links page and support requests.
-- Idempotent.

begin;

-- ------------------------------------------------------------
-- Review link validation. Mirrors lib/validation.js (the same test list runs against both).
-- Only https links to Google review / Maps pages are accepted, so a plate can never be
-- pointed at an arbitrary website.
-- ------------------------------------------------------------
create or replace function public.is_valid_review_url(p_url text) returns boolean
language plpgsql immutable set search_path = public as $$
declare
  v_host text;
  v_path text;
begin
  if p_url is null or length(p_url) > 600 or p_url ~ '[[:space:]]' then
    return false;
  end if;
  if p_url !~ '^https://[A-Za-z0-9.-]+([/?#]|$)' then
    return false;
  end if;
  v_host := lower(substring(p_url from '^https://([A-Za-z0-9.-]+)'));
  v_path := coalesce(substring(p_url from '^https://[A-Za-z0-9.-]+(/[^?#]*)'), '/');
  if v_host in ('g.page', 'maps.app.goo.gl', 'share.google', 'maps.google.com', 'maps.google.com.my') then
    return true;
  end if;
  if v_host = 'search.google.com' then
    return v_path ~ '^/local/';
  end if;
  if v_host = 'goo.gl' then
    return v_path ~ '^/maps/';
  end if;
  if v_host = 'g.co' then
    return v_path ~ '^/kgs/';
  end if;
  if v_host in ('google.com', 'www.google.com', 'google.com.my', 'www.google.com.my') then
    return v_path ~ '^/(maps|search|local)(/|$)';
  end if;
  return false;
end;
$$;
revoke all on function public.is_valid_review_url(text) from public, anon;
grant execute on function public.is_valid_review_url(text) to authenticated, service_role;

-- ------------------------------------------------------------
-- Owner actions (also usable by admins). Each one checks ownership itself.
-- ------------------------------------------------------------

-- Changes the Google review destination of a location and of all its plates, in one transaction.
create or replace function public.update_business_review_url(p_business_id uuid, p_url text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_url text := trim(coalesce(p_url, ''));
  v_old text;
begin
  if not (public.is_admin() or public.owns_business(p_business_id)) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if not public.is_valid_review_url(v_url) then
    raise exception 'invalid_review_url' using errcode = 'P0001';
  end if;
  select review_url into v_old from public.businesses where id = p_business_id;
  update public.businesses set review_url = v_url where id = p_business_id;
  update public.plates set destination_url = v_url where business_id = p_business_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'review_url.updated', 'business', p_business_id, jsonb_build_object('from', v_old, 'to', v_url));
end;
$$;
revoke all on function public.update_business_review_url(uuid, text) from public, anon;
grant execute on function public.update_business_review_url(uuid, text) to authenticated;

create or replace function public.update_business_details(p_business_id uuid, p_name text, p_address text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_name text := trim(coalesce(p_name, ''));
begin
  if not (public.is_admin() or public.owns_business(p_business_id)) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if length(v_name) < 1 or length(v_name) > 100 then
    raise exception 'invalid_name' using errcode = 'P0001';
  end if;
  update public.businesses
     set name = v_name, address = nullif(left(trim(coalesce(p_address, '')), 200), '')
   where id = p_business_id;
  update public.plates set business_name = v_name where business_id = p_business_id;
end;
$$;
revoke all on function public.update_business_details(uuid, text, text) from public, anon;
grant execute on function public.update_business_details(uuid, text, text) to authenticated;

create or replace function public.update_plate_label(p_plate_id uuid, p_label text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_business uuid;
begin
  select business_id into v_business from public.plates where id = p_plate_id;
  if v_business is null or not (public.is_admin() or public.owns_business(v_business)) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update public.plates set label = nullif(left(trim(coalesce(p_label, '')), 40), '') where id = p_plate_id;
end;
$$;
revoke all on function public.update_plate_label(uuid, text) from public, anon;
grant execute on function public.update_plate_label(uuid, text) to authenticated;

create or replace function public.update_my_account(
  p_company_id uuid, p_name text, p_contact_name text, p_phone text, p_whatsapp text,
  p_email_monthly_summary boolean, p_email_review_alerts boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_name text := trim(coalesce(p_name, ''));
  v_phone text := nullif(left(trim(coalesce(p_phone, '')), 30), '');
  v_whatsapp text := nullif(left(trim(coalesce(p_whatsapp, '')), 30), '');
begin
  if not (public.is_admin() or public.owns_company(p_company_id)) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if length(v_name) < 1 or length(v_name) > 100 then
    raise exception 'invalid_name' using errcode = 'P0001';
  end if;
  if (v_phone is not null and v_phone !~ '^\+?[0-9 ()-]{6,30}$')
     or (v_whatsapp is not null and v_whatsapp !~ '^\+?[0-9 ()-]{6,30}$') then
    raise exception 'invalid_phone' using errcode = 'P0001';
  end if;
  update public.companies
     set name = v_name,
         contact_name = nullif(left(trim(coalesce(p_contact_name, '')), 100), ''),
         phone = v_phone,
         whatsapp = v_whatsapp,
         email_monthly_summary = coalesce(p_email_monthly_summary, email_monthly_summary),
         email_review_alerts = coalesce(p_email_review_alerts, email_review_alerts)
   where id = p_company_id;
end;
$$;
revoke all on function public.update_my_account(uuid, text, text, text, text, boolean, boolean) from public, anon;
grant execute on function public.update_my_account(uuid, text, text, text, text, boolean, boolean) to authenticated;

-- ------------------------------------------------------------
-- Pro: "additional business links" — one small public page per location.
-- The Google review button is always shown first and is the same for every visitor.
-- ------------------------------------------------------------
create table if not exists public.link_pages (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  headline text,
  links jsonb not null default '[]'::jsonb,
  published boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.link_pages enable row level security;
revoke all on public.link_pages from anon;
revoke all on public.link_pages from authenticated;
grant select on public.link_pages to authenticated;
grant all on public.link_pages to service_role;

drop policy if exists link_pages_select on public.link_pages;
create policy link_pages_select on public.link_pages for select
  using (public.is_admin() or public.owns_business(business_id));

-- p_links: [{ "kind": "menu", "label": "Our menu", "url": "https://..." }, ...] (max 8).
-- Every URL is validated here as well as in the app (https, tel:, mailto: or wa.me only).
create or replace function public.save_link_page(p_business_id uuid, p_headline text, p_links jsonb, p_published boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_item jsonb;
  v_clean jsonb := '[]'::jsonb;
  v_kind text;
  v_label text;
  v_url text;
begin
  if not (public.is_admin() or public.owns_business(p_business_id)) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if not (public.is_admin() or public.business_is_pro(p_business_id)) then
    raise exception 'pro_required' using errcode = 'P0001';
  end if;
  if p_links is null or jsonb_typeof(p_links) <> 'array' or jsonb_array_length(p_links) > 8 then
    raise exception 'invalid_links' using errcode = 'P0001';
  end if;
  for v_item in select * from jsonb_array_elements(p_links) loop
    v_kind := coalesce(v_item ->> 'kind', 'other');
    v_label := trim(coalesce(v_item ->> 'label', ''));
    v_url := trim(coalesce(v_item ->> 'url', ''));
    if v_kind not in ('menu', 'whatsapp', 'instagram', 'facebook', 'tiktok', 'booking', 'website', 'phone', 'email', 'other') then
      raise exception 'invalid_links' using errcode = 'P0001';
    end if;
    if length(v_label) < 1 or length(v_label) > 40 then
      raise exception 'invalid_links' using errcode = 'P0001';
    end if;
    if length(v_url) > 500 or v_url ~ '[[:space:]]' or not (
         v_url ~ '^https://[A-Za-z0-9.-]+\.[A-Za-z]{2,}([/?#]|$)'
         or v_url ~ '^tel:\+?[0-9]{6,15}$'
         or v_url ~ '^mailto:[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$') then
      raise exception 'invalid_links' using errcode = 'P0001';
    end if;
    v_clean := v_clean || jsonb_build_array(jsonb_build_object('kind', v_kind, 'label', v_label, 'url', v_url));
  end loop;

  insert into public.link_pages (business_id, headline, links, published, updated_at)
  values (p_business_id, nullif(left(trim(coalesce(p_headline, '')), 120), ''), v_clean, coalesce(p_published, true), now())
  on conflict (business_id) do update
    set headline = excluded.headline, links = excluded.links, published = excluded.published, updated_at = now();
end;
$$;
revoke all on function public.save_link_page(uuid, text, jsonb, boolean) from public, anon;
grant execute on function public.save_link_page(uuid, text, jsonb, boolean) to authenticated;

-- Public read of a links page by slug. Extra links are only returned while the location is Pro;
-- the Google review link is always returned, so a printed link never breaks after a cancellation.
create or replace function public.get_link_page(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'name', b.name,
    'review_url', b.review_url,
    'headline', case when pro.is_pro and coalesce(lp.published, false) then lp.headline end,
    'links', case when pro.is_pro and coalesce(lp.published, false) then lp.links else '[]'::jsonb end
  )
  from public.businesses b
  cross join lateral (select public.business_is_pro(b.id) as is_pro) pro
  left join public.link_pages lp on lp.business_id = b.id
  where b.slug = lower(trim(p_slug));
$$;
revoke all on function public.get_link_page(text) from public;
grant execute on function public.get_link_page(text) to anon, authenticated, service_role;

-- ------------------------------------------------------------
-- Support requests sent from the dashboard help page.
-- ------------------------------------------------------------
create table if not exists public.support_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  company_id uuid references public.companies (id) on delete set null,
  email text,
  topic text not null,
  message text not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now()
);
create index if not exists support_requests_status_idx on public.support_requests (status, created_at desc);
alter table public.support_requests enable row level security;
revoke all on public.support_requests from anon;
revoke all on public.support_requests from authenticated;
grant select, update on public.support_requests to authenticated;
grant all on public.support_requests to service_role;

drop policy if exists support_requests_select on public.support_requests;
create policy support_requests_select on public.support_requests for select
  using (public.is_admin() or user_id = (select auth.uid()));
drop policy if exists support_requests_admin_update on public.support_requests;
create policy support_requests_admin_update on public.support_requests for update
  using (public.is_admin()) with check (public.is_admin());

create or replace function public.create_support_request(p_topic text, p_message text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_topic text := left(trim(coalesce(p_topic, '')), 60);
  v_message text := trim(coalesce(p_message, ''));
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if length(v_topic) < 1 or length(v_message) < 5 or length(v_message) > 3000 then
    raise exception 'invalid_message' using errcode = 'P0001';
  end if;
  if (select count(*) from public.support_requests where user_id = v_uid and created_at > now() - interval '1 day') >= 5 then
    raise exception 'too_many_requests' using errcode = 'P0001';
  end if;
  insert into public.support_requests (user_id, company_id, email, topic, message)
  values (
    v_uid,
    (select id from public.companies where owner_id = v_uid order by created_at limit 1),
    auth.jwt() ->> 'email', v_topic, v_message)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.create_support_request(text, text) from public, anon;
grant execute on function public.create_support_request(text, text) to authenticated;

notify pgrst, 'reload schema';

commit;
