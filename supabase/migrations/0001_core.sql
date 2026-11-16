-- ReviewLah — migration 0001: companies, locations (businesses), subscriptions, scan dedup.
-- Idempotent: safe to run several times. Backward compatible: the legacy columns on
-- public.plates (business_name, owner_email, owner_id, plan) are kept during the transition,
-- and the previous app version keeps working after this migration.
--
-- Run order: supabase/schema.sql (already applied) -> 0001 -> 0002 -> 0003 -> 0004 -> 0005.

begin;

-- ============================================================
-- 1. Tables
-- ============================================================

-- A company is the customer (the "entreprise"): one owner login, one or several locations.
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_email text,
  owner_id uuid references auth.users (id) on delete set null,
  contact_name text,
  phone text,
  whatsapp text,
  email_monthly_summary boolean not null default true,
  email_review_alerts boolean not null default true,
  admin_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists companies_owner_email_key
  on public.companies (lower(owner_email)) where owner_email is not null;
create index if not exists companies_owner_id_idx on public.companies (owner_id);

-- A business is one location ("lieu"). A company has one or several, a location has one or several plates.
create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete restrict,
  name text not null,
  address text,
  review_url text,
  slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists businesses_company_idx on public.businesses (company_id);

alter table public.plates add column if not exists business_id uuid references public.businesses (id) on delete restrict;
alter table public.plates add column if not exists label text;
alter table public.plates add column if not exists total_scans bigint not null default 0;
alter table public.plates add column if not exists last_scan_at timestamptz;
create index if not exists plates_business_idx on public.plates (business_id);

-- Short-lived, salted device fingerprint used only to ignore an immediate re-tap. Never an IP address.
alter table public.scans add column if not exists device_hash text;

-- One subscription row per billing relationship. Pro is read from here, not from plates.plan.
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  plan text not null default 'pro' check (plan in ('pro')),
  billing_interval text check (billing_interval in ('month', 'year')),
  status text not null check (status in ('incomplete', 'trialing', 'active', 'past_due', 'canceled')),
  provider text not null default 'manual' check (provider ~ '^[a-z0-9_]{2,30}$'),
  provider_customer_id text,
  provider_subscription_id text,
  provider_checkout_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists subscriptions_business_idx on public.subscriptions (business_id);
-- At most one live subscription per location.
create unique index if not exists subscriptions_one_live_per_business
  on public.subscriptions (business_id) where status in ('trialing', 'active', 'past_due');
create unique index if not exists subscriptions_provider_sub_key
  on public.subscriptions (provider, provider_subscription_id) where provider_subscription_id is not null;
create unique index if not exists subscriptions_provider_checkout_key
  on public.subscriptions (provider, provider_checkout_id) where provider_checkout_id is not null;

-- Who changed what (review link, plan, account). Readable by admins only.
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  entity text not null,
  entity_id uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_entity_idx on public.audit_log (entity, entity_id, created_at desc);

-- Server-side values that never leave the database (no API access at all).
create table if not exists public.private_settings (
  key text primary key,
  value text not null
);
-- Random salt for the scan de-duplication fingerprint, generated once per database.
insert into public.private_settings (key, value)
values ('scan_salt', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

-- ============================================================
-- 2. Helpers
-- ============================================================

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create or replace function public.owns_company(p_company_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.companies c
     where c.id = p_company_id and c.owner_id = auth.uid() and auth.uid() is not null
  );
$$;

create or replace function public.owns_business(p_business_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.businesses b
      join public.companies c on c.id = b.company_id
     where b.id = p_business_id and c.owner_id = auth.uid() and auth.uid() is not null
  );
$$;

-- Pro entitlement for one location. A short grace period covers webhook delays and payment retries;
-- a manual (admin) subscription has no grace.
create or replace function public.business_is_pro(p_business_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.subscriptions s
     where s.business_id = p_business_id
       and s.plan = 'pro'
       and s.status in ('trialing', 'active', 'past_due')
       and (
         s.current_period_end is null
         or s.current_period_end + (case
              when s.provider = 'manual' then interval '0'
              when s.status = 'past_due' then interval '8 days'
              else interval '3 days' end) > now()
       )
  );
$$;

create or replace function public.make_slug(p_name text) returns text
language sql volatile set search_path = public as $$
  select left(coalesce(nullif(trim(both '-' from regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', '-', 'g')), ''), 'business'), 40)
         || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
$$;

-- Plate codes: 5 characters, no 0/O/1/I to avoid reading mistakes.
create or replace function public.make_plate_code() returns text
language plpgsql volatile set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  b bytea;
  c text;
begin
  loop
    b := uuid_send(gen_random_uuid());
    c := '';
    for i in 0..4 loop
      c := c || substr(alphabet, (get_byte(b, i) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.plates where code = c);
  end loop;
  return c;
end;
$$;

-- Finds or creates the company + location matching the legacy plate columns.
create or replace function public.ensure_business_for(
  p_owner_email text, p_owner_id uuid, p_business_name text, p_review_url text, p_created_at timestamptz default now()
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_email text := nullif(lower(trim(coalesce(p_owner_email, ''))), '');
  v_name text := coalesce(nullif(trim(coalesce(p_business_name, '')), ''), 'My business');
  v_company uuid;
  v_business uuid;
begin
  if v_email is not null then
    select id into v_company from public.companies where lower(owner_email) = v_email;
  end if;
  if v_company is null and p_owner_id is not null then
    select id into v_company from public.companies where owner_id = p_owner_id order by created_at limit 1;
  end if;
  if v_company is null and v_email is null and p_owner_id is null then
    select id into v_company from public.companies
     where owner_email is null and owner_id is null and lower(name) = lower(v_name)
     order by created_at limit 1;
  end if;
  if v_company is null then
    insert into public.companies (name, owner_email, owner_id, created_at)
    values (v_name, v_email, p_owner_id, coalesce(p_created_at, now()))
    returning id into v_company;
  end if;

  select id into v_business from public.businesses
   where company_id = v_company and lower(name) = lower(v_name)
   order by created_at limit 1;
  if v_business is null then
    insert into public.businesses (company_id, name, review_url, slug, created_at)
    values (v_company, v_name, p_review_url, public.make_slug(v_name), coalesce(p_created_at, now()))
    returning id into v_business;
  end if;
  return v_business;
end;
$$;

-- Keeps old and new code compatible: a plate inserted the old way (no business_id) gets its
-- company + location; a plate inserted the new way gets its legacy columns filled.
create or replace function public.plates_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_b public.businesses;
  v_c public.companies;
begin
  if new.business_id is null then
    new.business_id := public.ensure_business_for(new.owner_email, new.owner_id, new.business_name, new.destination_url, new.created_at);
  end if;
  select * into v_b from public.businesses where id = new.business_id;
  select * into v_c from public.companies where id = v_b.company_id;
  if new.business_name is null then new.business_name := v_b.name; end if;
  if new.owner_email is null then new.owner_email := v_c.owner_email; end if;
  if new.owner_id is null then new.owner_id := v_c.owner_id; end if;
  if new.destination_url is null then new.destination_url := v_b.review_url; end if;
  new.code := upper(trim(new.code));
  return new;
end;
$$;
drop trigger if exists plates_before_insert on public.plates;
create trigger plates_before_insert before insert on public.plates
  for each row execute function public.plates_before_insert();

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists companies_touch on public.companies;
create trigger companies_touch before update on public.companies for each row execute function public.touch_updated_at();
drop trigger if exists businesses_touch on public.businesses;
create trigger businesses_touch before update on public.businesses for each row execute function public.touch_updated_at();
drop trigger if exists subscriptions_touch on public.subscriptions;
create trigger subscriptions_touch before update on public.subscriptions for each row execute function public.touch_updated_at();

-- ============================================================
-- 3. Data migration (existing plates -> company + location + subscription). No data is deleted.
-- ============================================================

do $$
declare
  r record;
  v_business uuid;
begin
  for r in select * from public.plates where business_id is null order by created_at loop
    v_business := public.ensure_business_for(r.owner_email, r.owner_id, r.business_name, r.destination_url, r.created_at);
    update public.plates set business_id = v_business where id = r.id;
    if r.plan = 'pro' and not exists (
      select 1 from public.subscriptions where business_id = v_business and status in ('trialing', 'active', 'past_due')
    ) then
      insert into public.subscriptions (business_id, plan, status, provider, current_period_start)
      values (v_business, 'pro', 'active', 'manual', now());
    end if;
  end loop;
end;
$$;

alter table public.plates alter column business_id set not null;

-- Counters used by the Basic dashboard (total scans, last scan) without reading the scans table.
update public.plates p
   set total_scans = s.n, last_scan_at = s.last_at
  from (select plate_id, count(*) as n, max(created_at) as last_at from public.scans group by plate_id) s
 where s.plate_id = p.id and (p.total_scans <> s.n or p.last_scan_at is distinct from s.last_at);

-- ============================================================
-- 4. Row level security
-- ============================================================

alter table public.companies enable row level security;
alter table public.businesses enable row level security;
alter table public.subscriptions enable row level security;
alter table public.audit_log enable row level security;
alter table public.private_settings enable row level security; -- no policy: definer functions only

-- The public site and the plate redirect never read tables directly: everything goes through
-- security-definer functions. Anonymous visitors get no table access at all.
revoke all on public.plates, public.scans, public.admins from anon;
revoke all on public.companies, public.businesses, public.subscriptions, public.audit_log from anon;
revoke all on public.private_settings from anon, authenticated;
revoke all on public.audit_log from authenticated;
grant select on public.audit_log to authenticated;
grant select, insert, update, delete on public.companies, public.businesses, public.subscriptions to authenticated;
grant all on public.companies, public.businesses, public.subscriptions, public.audit_log to service_role;

drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies for select
  using (owner_id = (select auth.uid()) or public.is_admin());
drop policy if exists companies_admin_write on public.companies;
create policy companies_admin_write on public.companies for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists businesses_select on public.businesses;
create policy businesses_select on public.businesses for select
  using (public.is_admin() or public.owns_company(company_id));
drop policy if exists businesses_admin_write on public.businesses;
create policy businesses_admin_write on public.businesses for all
  using (public.is_admin()) with check (public.is_admin());

-- Plates: the owner sees the plates of their locations (owner_id kept for the previous app version).
drop policy if exists plates_select on public.plates;
create policy plates_select on public.plates for select
  using (public.is_admin() or owner_id = (select auth.uid()) or public.owns_business(business_id));

-- Scans: detailed scan rows are a Pro feature. Basic reads only the counters on public.plates.
drop policy if exists scans_select on public.scans;
create policy scans_select on public.scans for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.plates p
       where p.id = scans.plate_id
         and public.owns_business(p.business_id)
         and public.business_is_pro(p.business_id)
    )
  );

drop policy if exists subscriptions_select on public.subscriptions;
create policy subscriptions_select on public.subscriptions for select
  using (public.is_admin() or public.owns_business(business_id));
drop policy if exists subscriptions_admin_write on public.subscriptions;
create policy subscriptions_admin_write on public.subscriptions for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists audit_log_admin_select on public.audit_log;
create policy audit_log_admin_select on public.audit_log for select using (public.is_admin());

-- ============================================================
-- 5. Plate redirect: record a scan and return the destination
-- ============================================================

-- p_device is an opaque hash computed by the app server (never an IP address). It is hashed again
-- here with a salt that only exists in this database, so what is stored cannot be linked back to
-- a device or an address. The same device tapping the same plate again within 15 seconds is
-- redirected but counted once. Counting can never block the redirect: any counting error is swallowed.
drop function if exists public.record_scan(text, text);
create or replace function public.record_scan(p_code text, p_source text default 'other', p_device text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_url text;
  v_source text := case when p_source in ('nfc', 'qr') then p_source else 'other' end;
  v_device text := nullif(left(coalesce(p_device, ''), 64), '');
begin
  select id, destination_url into v_id, v_url
    from public.plates where code = upper(trim(p_code)) and active;
  if not found then
    return null;
  end if;

  begin
    if v_device is not null then
      select left(encode(sha256(convert_to(ps.value || '|' || v_device, 'UTF8')), 'hex'), 32) into v_device
        from public.private_settings ps where ps.key = 'scan_salt';
      perform pg_advisory_xact_lock(hashtextextended(v_id::text || ':' || v_device, 0));
      if exists (
        select 1 from public.scans
         where plate_id = v_id and device_hash = v_device and created_at > now() - interval '15 seconds'
      ) then
        return v_url;
      end if;
    end if;
    insert into public.scans (plate_id, source, device_hash) values (v_id, v_source, v_device);
    update public.plates set total_scans = total_scans + 1, last_scan_at = now() where id = v_id;
  exception when others then
    null;
  end;
  return v_url;
end;
$$;
revoke all on function public.record_scan(text, text, text) from public;
grant execute on function public.record_scan(text, text, text) to anon, authenticated, service_role;

-- Destination only, without counting: used for link previews, crawlers and HEAD requests.
create or replace function public.plate_destination(p_code text) returns text
language sql stable security definer set search_path = public as $$
  select destination_url from public.plates where code = upper(trim(p_code)) and active;
$$;
revoke all on function public.plate_destination(text) from public;
grant execute on function public.plate_destination(text) to anon, authenticated, service_role;

-- ============================================================
-- 6. Login: attach the account to the signed-in user
-- ============================================================

create or replace function public.claim_account() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_email text := nullif(lower(trim(coalesce(auth.jwt() ->> 'email', ''))), '');
begin
  if v_uid is null or v_email is null then
    return;
  end if;
  update public.companies set owner_id = v_uid
   where owner_id is null and owner_email is not null and lower(owner_email) = v_email;
  -- After a confirmed email change, the account follows the new login email.
  update public.companies c set owner_email = v_email
   where c.owner_id = v_uid
     and (c.owner_email is null or lower(c.owner_email) <> v_email)
     and not exists (select 1 from public.companies o where lower(o.owner_email) = v_email and o.id <> c.id);
  -- Legacy columns, kept in sync during the transition.
  update public.plates p set owner_id = c.owner_id, owner_email = c.owner_email
    from public.businesses b
    join public.companies c on c.id = b.company_id
   where p.business_id = b.id and c.owner_id = v_uid
     and (p.owner_id is distinct from c.owner_id or p.owner_email is distinct from c.owner_email);
end;
$$;
revoke all on function public.claim_account() from public, anon;
grant execute on function public.claim_account() to authenticated;

-- Previous app version calls claim_plates(): same behaviour, through the new model.
create or replace function public.claim_plates() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.claim_account();
end;
$$;
revoke all on function public.claim_plates() from public, anon;
grant execute on function public.claim_plates() to authenticated;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;
revoke all on function public.owns_company(uuid) from public, anon;
grant execute on function public.owns_company(uuid) to authenticated, service_role;
revoke all on function public.owns_business(uuid) from public, anon;
grant execute on function public.owns_business(uuid) to authenticated, service_role;
revoke all on function public.business_is_pro(uuid) from public, anon;
grant execute on function public.business_is_pro(uuid) to authenticated, service_role;
revoke all on function public.make_slug(text) from public, anon, authenticated;
revoke all on function public.make_plate_code() from public, anon, authenticated;
revoke all on function public.ensure_business_for(text, uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.plates_before_insert() from public, anon, authenticated;
revoke all on function public.touch_updated_at() from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
