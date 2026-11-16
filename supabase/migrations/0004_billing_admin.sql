-- ReviewLah — migration 0004: payments, webhook event log, email log, admin tools, maintenance.
-- Idempotent.

begin;

-- ------------------------------------------------------------
-- Tables
-- ------------------------------------------------------------

alter table public.subscriptions add column if not exists provider_event_at timestamptz;

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses (id) on delete set null,
  subscription_id uuid references public.subscriptions (id) on delete set null,
  provider text not null,
  provider_payment_id text not null,
  status text not null check (status in ('succeeded', 'failed', 'refunded', 'pending')),
  amount_cents integer not null default 0,
  currency text not null default 'MYR',
  description text,
  invoice_url text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_payment_id)
);
create index if not exists payments_business_idx on public.payments (business_id, created_at desc);

-- Every webhook delivery, stored once (idempotency) with its outcome.
create table if not exists public.payment_events (
  id bigint generated always as identity primary key,
  provider text not null,
  event_id text not null,
  event_type text,
  payload jsonb not null default '{}'::jsonb,
  outcome text,
  error text,
  received_at timestamptz not null default now(),
  unique (provider, event_id)
);

-- One line per email sent (or attempted). The unique key makes the monthly summary idempotent.
create table if not exists public.email_log (
  id bigint generated always as identity primary key,
  company_id uuid references public.companies (id) on delete set null,
  kind text not null,
  period text not null default '',
  to_email text not null,
  status text not null default 'sent' check (status in ('sent', 'failed', 'skipped')),
  provider_id text,
  error text,
  created_at timestamptz not null default now()
);
create unique index if not exists email_log_once_key on public.email_log (company_id, kind, period)
  where period <> '' and status = 'sent';

alter table public.payments enable row level security;
alter table public.payment_events enable row level security;
alter table public.email_log enable row level security;

revoke all on public.payments, public.payment_events, public.email_log from anon;
revoke all on public.payments, public.payment_events, public.email_log from authenticated;
grant select on public.payments, public.email_log to authenticated;
grant all on public.payments, public.payment_events, public.email_log to service_role;

drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments for select
  using (public.is_admin() or public.owns_business(business_id));
drop policy if exists email_log_admin_select on public.email_log;
create policy email_log_admin_select on public.email_log for select using (public.is_admin());
-- payment_events: no policy on purpose. Server-side (service role) only.

drop trigger if exists payments_touch on public.payments;
create trigger payments_touch before update on public.payments for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- billing_apply_event(): the single place where a payment provider event changes our data.
-- Provider-agnostic: each adapter turns its own webhook into the "normalized" JSON below.
--   { "kind": "subscription", "business_id", "provider_subscription_id", "provider_customer_id",
--     "provider_checkout_id", "status", "billing_interval", "current_period_start",
--     "current_period_end", "cancel_at_period_end", "canceled_at", "occurred_at" }
--   { "kind": "payment", "provider_payment_id", "provider_subscription_id", "business_id",
--     "status", "amount_cents", "currency", "paid_at", "invoice_url", "description" }
--   { "kind": "ignore" }
-- Returns { "outcome": "applied" | "duplicate" | "ignored" | "unmatched", ... }.
-- ------------------------------------------------------------
create or replace function public.billing_apply_event(
  p_provider text, p_event_id text, p_event_type text, p_payload jsonb, p_normalized jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_kind text := coalesce(p_normalized ->> 'kind', 'ignore');
  v_event_row bigint;
  v_sub public.subscriptions;
  v_business uuid := nullif(p_normalized ->> 'business_id', '')::uuid;
  v_provider_sub text := nullif(p_normalized ->> 'provider_subscription_id', '');
  v_checkout text := nullif(p_normalized ->> 'provider_checkout_id', '');
  v_status text := p_normalized ->> 'status';
  v_occurred timestamptz := coalesce(nullif(p_normalized ->> 'occurred_at', '')::timestamptz, now());
  v_prev_status text;
  v_live boolean;
  v_result jsonb;
  v_payment uuid;
begin
  insert into public.payment_events (provider, event_id, event_type, payload)
  values (p_provider, p_event_id, p_event_type, coalesce(p_payload, '{}'::jsonb))
  on conflict (provider, event_id) do nothing
  returning id into v_event_row;
  if v_event_row is null then
    return jsonb_build_object('outcome', 'duplicate');
  end if;

  if v_kind = 'subscription' then
    if v_status is null or v_status not in ('incomplete', 'trialing', 'active', 'past_due', 'canceled') then
      update public.payment_events set outcome = 'ignored', error = 'unknown status' where id = v_event_row;
      return jsonb_build_object('outcome', 'ignored');
    end if;
    v_live := v_status in ('trialing', 'active', 'past_due');

    if v_provider_sub is not null then
      select * into v_sub from public.subscriptions
       where provider = p_provider and provider_subscription_id = v_provider_sub;
    end if;
    if v_sub.id is null and v_checkout is not null then
      select * into v_sub from public.subscriptions
       where provider = p_provider and provider_checkout_id = v_checkout;
    end if;
    if v_sub.id is null and v_business is not null then
      select * into v_sub from public.subscriptions
       where provider = p_provider and business_id = v_business and status = 'incomplete'
         and provider_subscription_id is null
       order by created_at desc limit 1;
    end if;
    if v_sub.id is null and v_business is null then
      update public.payment_events set outcome = 'unmatched' where id = v_event_row;
      return jsonb_build_object('outcome', 'unmatched');
    end if;
    if v_sub.id is not null then
      v_business := v_sub.business_id;
    end if;
    if not exists (select 1 from public.businesses where id = v_business) then
      update public.payment_events set outcome = 'unmatched' where id = v_event_row;
      return jsonb_build_object('outcome', 'unmatched');
    end if;

    -- Events can arrive out of order: never let an older event overwrite a newer state.
    if v_sub.id is not null and v_sub.provider_event_at is not null and v_occurred < v_sub.provider_event_at then
      update public.payment_events set outcome = 'ignored', error = 'older than current state' where id = v_event_row;
      return jsonb_build_object('outcome', 'ignored', 'business_id', v_business);
    end if;

    if v_live then
      -- A paid subscription replaces a manual (admin) one; any other live duplicate is closed and flagged.
      insert into public.audit_log (action, entity, entity_id, detail)
      select 'subscription.superseded', 'subscription', s.id,
             jsonb_build_object('provider', s.provider, 'by_provider', p_provider, 'by_subscription', v_provider_sub)
        from public.subscriptions s
       where s.business_id = v_business and s.status in ('trialing', 'active', 'past_due')
         and (v_sub.id is null or s.id <> v_sub.id);
      update public.subscriptions s
         set status = 'canceled', canceled_at = coalesce(s.canceled_at, now()), ended_at = now()
       where s.business_id = v_business and s.status in ('trialing', 'active', 'past_due')
         and (v_sub.id is null or s.id <> v_sub.id);
    end if;

    v_prev_status := v_sub.status;
    if v_sub.id is null then
      insert into public.subscriptions (
        business_id, plan, billing_interval, status, provider, provider_customer_id, provider_subscription_id,
        provider_checkout_id, current_period_start, current_period_end, cancel_at_period_end, canceled_at,
        ended_at, provider_event_at)
      values (
        v_business, 'pro', nullif(p_normalized ->> 'billing_interval', ''), v_status, p_provider,
        nullif(p_normalized ->> 'provider_customer_id', ''), v_provider_sub, v_checkout,
        nullif(p_normalized ->> 'current_period_start', '')::timestamptz,
        nullif(p_normalized ->> 'current_period_end', '')::timestamptz,
        coalesce((p_normalized ->> 'cancel_at_period_end')::boolean, false),
        nullif(p_normalized ->> 'canceled_at', '')::timestamptz,
        case when v_status = 'canceled' then now() end, v_occurred)
      returning * into v_sub;
    else
      update public.subscriptions s set
        status = v_status,
        billing_interval = coalesce(nullif(p_normalized ->> 'billing_interval', ''), s.billing_interval),
        provider_customer_id = coalesce(nullif(p_normalized ->> 'provider_customer_id', ''), s.provider_customer_id),
        provider_subscription_id = coalesce(v_provider_sub, s.provider_subscription_id),
        provider_checkout_id = coalesce(v_checkout, s.provider_checkout_id),
        current_period_start = coalesce(nullif(p_normalized ->> 'current_period_start', '')::timestamptz, s.current_period_start),
        current_period_end = coalesce(nullif(p_normalized ->> 'current_period_end', '')::timestamptz, s.current_period_end),
        cancel_at_period_end = coalesce((p_normalized ->> 'cancel_at_period_end')::boolean, s.cancel_at_period_end),
        canceled_at = case when v_status = 'canceled'
                           then coalesce(nullif(p_normalized ->> 'canceled_at', '')::timestamptz, s.canceled_at, now())
                           else nullif(p_normalized ->> 'canceled_at', '')::timestamptz end,
        ended_at = case when v_status = 'canceled' then coalesce(s.ended_at, now()) else null end,
        provider_event_at = v_occurred
      where s.id = v_sub.id
      returning * into v_sub;
    end if;

    v_result := jsonb_build_object(
      'outcome', 'applied', 'kind', 'subscription', 'business_id', v_business,
      'subscription_id', v_sub.id, 'status', v_sub.status, 'previous_status', v_prev_status);

  elsif v_kind = 'payment' then
    if v_status is null or v_status not in ('succeeded', 'failed', 'refunded', 'pending')
       or nullif(p_normalized ->> 'provider_payment_id', '') is null then
      update public.payment_events set outcome = 'ignored', error = 'invalid payment' where id = v_event_row;
      return jsonb_build_object('outcome', 'ignored');
    end if;
    if v_provider_sub is not null then
      select * into v_sub from public.subscriptions
       where provider = p_provider and provider_subscription_id = v_provider_sub;
      if v_sub.id is not null then
        v_business := v_sub.business_id;
      end if;
    end if;
    if v_business is not null and not exists (select 1 from public.businesses where id = v_business) then
      v_business := null;
    end if;
    insert into public.payments (
      business_id, subscription_id, provider, provider_payment_id, status, amount_cents, currency,
      description, invoice_url, paid_at)
    values (
      v_business, v_sub.id, p_provider, p_normalized ->> 'provider_payment_id', v_status,
      coalesce((p_normalized ->> 'amount_cents')::integer, 0),
      upper(coalesce(nullif(p_normalized ->> 'currency', ''), 'MYR')),
      nullif(p_normalized ->> 'description', ''), nullif(p_normalized ->> 'invoice_url', ''),
      nullif(p_normalized ->> 'paid_at', '')::timestamptz)
    on conflict (provider, provider_payment_id) do update set
      status = excluded.status,
      amount_cents = case when excluded.amount_cents > 0 then excluded.amount_cents else public.payments.amount_cents end,
      business_id = coalesce(public.payments.business_id, excluded.business_id),
      subscription_id = coalesce(public.payments.subscription_id, excluded.subscription_id),
      invoice_url = coalesce(excluded.invoice_url, public.payments.invoice_url),
      paid_at = coalesce(excluded.paid_at, public.payments.paid_at)
    returning id into v_payment;
    v_result := jsonb_build_object(
      'outcome', 'applied', 'kind', 'payment', 'business_id', v_business,
      'payment_id', v_payment, 'status', v_status);
  else
    update public.payment_events set outcome = 'ignored' where id = v_event_row;
    return jsonb_build_object('outcome', 'ignored');
  end if;

  update public.payment_events set outcome = 'applied' where id = v_event_row;
  return v_result;
end;
$$;
revoke all on function public.billing_apply_event(text, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.billing_apply_event(text, text, text, jsonb, jsonb) to service_role;

-- ------------------------------------------------------------
-- Owner side of a subscription: start a checkout, schedule / undo a cancellation.
-- The payment itself is confirmed by the provider webhook (billing_apply_event), never by the browser.
-- ------------------------------------------------------------

-- Opens a checkout for one location: returns the row to attach the provider checkout to, plus
-- what the provider needs to know about the customer.
create or replace function public.billing_begin_checkout(p_business_id uuid, p_interval text, p_provider text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_b public.businesses;
  v_c public.companies;
  v_id uuid;
  v_customer text;
begin
  if not (public.is_admin() or public.owns_business(p_business_id)) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_interval is null or p_interval not in ('month', 'year') then
    raise exception 'invalid_interval' using errcode = 'P0001';
  end if;
  if p_provider is null or p_provider !~ '^[a-z0-9_]{2,30}$' or p_provider = 'manual' then
    raise exception 'invalid_provider' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.subscriptions
     where business_id = p_business_id and provider <> 'manual' and status in ('trialing', 'active', 'past_due')
  ) then
    raise exception 'already_subscribed' using errcode = 'P0001';
  end if;
  select * into v_b from public.businesses where id = p_business_id;
  select * into v_c from public.companies where id = v_b.company_id;

  -- One open checkout per location and provider: a new attempt replaces the previous one.
  delete from public.subscriptions
   where business_id = p_business_id and provider = p_provider and status = 'incomplete';
  insert into public.subscriptions (business_id, plan, billing_interval, status, provider)
  values (p_business_id, 'pro', p_interval, 'incomplete', p_provider)
  returning id into v_id;

  -- Reuse the customer record already created at this provider for the same company, if any.
  select s.provider_customer_id into v_customer
    from public.subscriptions s
    join public.businesses b on b.id = s.business_id
   where b.company_id = v_c.id and s.provider = p_provider and s.provider_customer_id is not null
   order by s.created_at desc limit 1;

  return jsonb_build_object(
    'subscription_id', v_id, 'business_id', v_b.id, 'business_name', v_b.name,
    'company_id', v_c.id, 'company_name', v_c.name, 'email', v_c.owner_email,
    'contact_name', v_c.contact_name, 'phone', v_c.phone, 'provider_customer_id', v_customer);
end;
$$;
revoke all on function public.billing_begin_checkout(uuid, text, text) from public, anon;
grant execute on function public.billing_begin_checkout(uuid, text, text) to authenticated;

create or replace function public.billing_attach_checkout(p_subscription_id uuid, p_checkout_id text, p_customer_id text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_business uuid;
begin
  select business_id into v_business from public.subscriptions where id = p_subscription_id and status = 'incomplete';
  if v_business is null or not (public.is_admin() or public.owns_business(v_business)) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update public.subscriptions
     set provider_checkout_id = nullif(left(trim(coalesce(p_checkout_id, '')), 200), ''),
         provider_customer_id = coalesce(nullif(left(trim(coalesce(p_customer_id, '')), 200), ''), provider_customer_id)
   where id = p_subscription_id;
end;
$$;
revoke all on function public.billing_attach_checkout(uuid, text, text) from public, anon;
grant execute on function public.billing_attach_checkout(uuid, text, text) to authenticated;

-- Schedules the cancellation at the end of the paid period (or undoes it). Pro stays on until then;
-- the plate and the Basic dashboard are never affected.
create or replace function public.billing_set_cancel(p_subscription_id uuid, p_cancel boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_sub public.subscriptions;
begin
  select * into v_sub from public.subscriptions where id = p_subscription_id;
  if v_sub.id is null or not (public.is_admin() or public.owns_business(v_sub.business_id)) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_sub.status not in ('trialing', 'active', 'past_due') then
    raise exception 'not_active' using errcode = 'P0001';
  end if;
  if v_sub.provider = 'manual' and not public.is_admin() then
    raise exception 'managed_by_support' using errcode = 'P0001';
  end if;
  update public.subscriptions
     set cancel_at_period_end = coalesce(p_cancel, true),
         canceled_at = case when coalesce(p_cancel, true) then coalesce(canceled_at, now()) else null end
   where id = p_subscription_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), case when coalesce(p_cancel, true) then 'subscription.cancel_scheduled' else 'subscription.cancel_undone' end,
          'subscription', p_subscription_id, jsonb_build_object('business_id', v_sub.business_id, 'provider', v_sub.provider));
end;
$$;
revoke all on function public.billing_set_cancel(uuid, boolean) from public, anon;
grant execute on function public.billing_set_cancel(uuid, boolean) to authenticated;

-- ------------------------------------------------------------
-- Admin tools
-- ------------------------------------------------------------

-- Manual Pro switch (used until the payment provider is live, and for gifts / fixes).
create or replace function public.admin_set_pro(p_business_id uuid, p_enabled boolean, p_until date default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_end timestamptz := case when p_until is null then null
                            else ((p_until + 1)::timestamp) at time zone 'Asia/Kuala_Lumpur' end;
begin
  if not public.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.businesses where id = p_business_id) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if p_enabled then
    if exists (
      select 1 from public.subscriptions
       where business_id = p_business_id and provider <> 'manual' and status in ('trialing', 'active', 'past_due')
    ) then
      raise exception 'provider_subscription_exists' using errcode = 'P0001';
    end if;
    update public.subscriptions
       set current_period_end = v_end, cancel_at_period_end = (v_end is not null)
     where business_id = p_business_id and provider = 'manual' and status in ('trialing', 'active', 'past_due');
    if not found then
      insert into public.subscriptions (business_id, plan, status, provider, current_period_start, current_period_end, cancel_at_period_end)
      values (p_business_id, 'pro', 'active', 'manual', now(), v_end, v_end is not null);
    end if;
  else
    update public.subscriptions
       set status = 'canceled', canceled_at = now(), ended_at = now()
     where business_id = p_business_id and provider = 'manual' and status in ('trialing', 'active', 'past_due');
  end if;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'pro.manual', 'business', p_business_id, jsonb_build_object('enabled', p_enabled, 'until', p_until));
end;
$$;
revoke all on function public.admin_set_pro(uuid, boolean, date) from public, anon;
grant execute on function public.admin_set_pro(uuid, boolean, date) to authenticated;

-- Creates (or reuses) the company, creates the location and its plates, optionally with Pro,
-- in a single transaction. If the owner email already has a login, the account is attached at once.
create or replace function public.admin_create_bundle(
  p_company_name text,
  p_owner_email text,
  p_contact_name text,
  p_phone text,
  p_business_name text,
  p_address text,
  p_review_url text,
  p_plate_count int default 1,
  p_plate_label text default null,
  p_pro boolean default false,
  p_pro_until date default null,
  p_company_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_email text := nullif(lower(trim(coalesce(p_owner_email, ''))), '');
  v_business_name text := trim(coalesce(p_business_name, ''));
  v_company_name text := coalesce(nullif(trim(coalesce(p_company_name, '')), ''), v_business_name);
  v_url text := trim(coalesce(p_review_url, ''));
  v_count int := least(greatest(coalesce(p_plate_count, 1), 0), 50);
  v_company uuid := p_company_id;
  v_existing boolean := false;
  v_business uuid;
  v_owner uuid;
  v_code text;
  v_plates jsonb := '[]'::jsonb;
  v_plate uuid;
begin
  if not public.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if length(v_business_name) < 1 or length(v_business_name) > 100 then
    raise exception 'invalid_name' using errcode = 'P0001';
  end if;
  if not public.is_valid_review_url(v_url) then
    raise exception 'invalid_review_url' using errcode = 'P0001';
  end if;
  if v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then
    raise exception 'invalid_email' using errcode = 'P0001';
  end if;

  if v_company is not null then
    if not exists (select 1 from public.companies where id = v_company) then
      raise exception 'not_found' using errcode = 'P0001';
    end if;
    v_existing := true;
  elsif v_email is not null then
    select id into v_company from public.companies where lower(owner_email) = v_email;
    v_existing := v_company is not null;
  end if;

  if v_company is null then
    if v_email is not null then
      select id into v_owner from auth.users where lower(email) = v_email limit 1;
    end if;
    insert into public.companies (name, owner_email, owner_id, contact_name, phone)
    values (v_company_name, v_email, v_owner,
            nullif(left(trim(coalesce(p_contact_name, '')), 100), ''),
            nullif(left(trim(coalesce(p_phone, '')), 30), ''))
    returning id into v_company;
  end if;

  insert into public.businesses (company_id, name, address, review_url, slug)
  values (v_company, v_business_name, nullif(left(trim(coalesce(p_address, '')), 200), ''), v_url, public.make_slug(v_business_name))
  returning id into v_business;

  for i in 1..v_count loop
    v_code := public.make_plate_code();
    insert into public.plates (code, business_id, business_name, destination_url, label)
    values (v_code, v_business, v_business_name, v_url, nullif(left(trim(coalesce(p_plate_label, '')), 40), ''))
    returning id into v_plate;
    v_plates := v_plates || jsonb_build_array(jsonb_build_object('id', v_plate, 'code', v_code));
  end loop;

  if coalesce(p_pro, false) then
    perform public.admin_set_pro(v_business, true, p_pro_until);
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'bundle.created', 'business', v_business,
          jsonb_build_object('company_id', v_company, 'plates', v_count, 'pro', coalesce(p_pro, false)));

  return jsonb_build_object(
    'company_id', v_company, 'business_id', v_business, 'existing_company', v_existing, 'plates', v_plates);
end;
$$;
revoke all on function public.admin_create_bundle(text, text, text, text, text, text, text, int, text, boolean, date, uuid) from public, anon;
grant execute on function public.admin_create_bundle(text, text, text, text, text, text, text, int, text, boolean, date, uuid) to authenticated;

-- Adds plates to an existing location.
create or replace function public.admin_add_plates(p_business_id uuid, p_count int default 1, p_label text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_b public.businesses;
  v_count int := least(greatest(coalesce(p_count, 1), 1), 50);
  v_code text;
  v_plate uuid;
  v_plates jsonb := '[]'::jsonb;
begin
  if not public.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select * into v_b from public.businesses where id = p_business_id;
  if v_b.id is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if not public.is_valid_review_url(v_b.review_url) then
    raise exception 'invalid_review_url' using errcode = 'P0001';
  end if;
  for i in 1..v_count loop
    v_code := public.make_plate_code();
    insert into public.plates (code, business_id, business_name, destination_url, label)
    values (v_code, v_b.id, v_b.name, v_b.review_url, nullif(left(trim(coalesce(p_label, '')), 40), ''))
    returning id into v_plate;
    v_plates := v_plates || jsonb_build_array(jsonb_build_object('id', v_plate, 'code', v_code));
  end loop;
  return jsonb_build_object('business_id', v_b.id, 'plates', v_plates);
end;
$$;
revoke all on function public.admin_add_plates(uuid, int, text) from public, anon;
grant execute on function public.admin_add_plates(uuid, int, text) to authenticated;

-- Changes the login email of a company (admin). Detaches the previous login; attaches the new one if it exists.
create or replace function public.admin_set_company_email(p_company_id uuid, p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_owner uuid;
begin
  if not public.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then
    raise exception 'invalid_email' using errcode = 'P0001';
  end if;
  if v_email is not null and exists (select 1 from public.companies where lower(owner_email) = v_email and id <> p_company_id) then
    raise exception 'email_in_use' using errcode = 'P0001';
  end if;
  if v_email is not null then
    select id into v_owner from auth.users where lower(email) = v_email limit 1;
  end if;
  update public.companies set owner_email = v_email, owner_id = v_owner where id = p_company_id;
  update public.plates p set owner_email = v_email, owner_id = v_owner
    from public.businesses b where p.business_id = b.id and b.company_id = p_company_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'company.email', 'company', p_company_id, jsonb_build_object('email', v_email));
end;
$$;
revoke all on function public.admin_set_company_email(uuid, text) from public, anon;
grant execute on function public.admin_set_company_email(uuid, text) to authenticated;

-- Moves a plate to another location (wrong location picked at creation, customer reorganisation).
-- The plate keeps its code and its scans, and takes the destination of its new location.
create or replace function public.admin_move_plate(p_plate_id uuid, p_business_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_b public.businesses;
  v_c public.companies;
  v_from uuid;
begin
  if not public.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select * into v_b from public.businesses where id = p_business_id;
  select business_id into v_from from public.plates where id = p_plate_id;
  if v_b.id is null or v_from is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  select * into v_c from public.companies where id = v_b.company_id;
  update public.plates
     set business_id = v_b.id, business_name = v_b.name, owner_email = v_c.owner_email, owner_id = v_c.owner_id,
         destination_url = coalesce(v_b.review_url, destination_url)
   where id = p_plate_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'plate.moved', 'plate', p_plate_id, jsonb_build_object('from', v_from, 'to', v_b.id));
end;
$$;
revoke all on function public.admin_move_plate(uuid, uuid) from public, anon;
grant execute on function public.admin_move_plate(uuid, uuid) to authenticated;

-- Deletes a plate created by mistake. Refused as soon as the plate has been scanned: pause it instead.
create or replace function public.admin_delete_plate(p_plate_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_code text;
begin
  if not public.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select code into v_code from public.plates where id = p_plate_id;
  if v_code is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.scans where plate_id = p_plate_id) then
    raise exception 'plate_has_scans' using errcode = 'P0001';
  end if;
  delete from public.plates where id = p_plate_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (auth.uid(), 'plate.deleted', 'plate', p_plate_id, jsonb_build_object('code', v_code));
end;
$$;
revoke all on function public.admin_delete_plate(uuid) from public, anon;
grant execute on function public.admin_delete_plate(uuid) to authenticated;

-- Customers list for the admin: companies with their locations, plates, plan and counters, in one call.
create or replace function public.admin_list_customers(p_search text default null, p_limit int default 50, p_offset int default 0)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_q text := nullif(lower(trim(coalesce(p_search, ''))), '');
  v_like text;
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  v_like := '%' || replace(replace(replace(coalesce(v_q, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';

  with matched as materialized (
    select c.*
      from public.companies c
     where v_q is null
        or lower(c.name) like v_like
        or lower(coalesce(c.owner_email, '')) like v_like
        or lower(coalesce(c.contact_name, '')) like v_like
        or exists (select 1 from public.businesses b where b.company_id = c.id and lower(b.name) like v_like)
        or exists (select 1 from public.plates p join public.businesses b on b.id = p.business_id
                    where b.company_id = c.id and lower(p.code) like v_like)
  ),
  page as (
    select * from matched order by created_at desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from matched),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'owner_email', c.owner_email, 'contact_name', c.contact_name,
        'phone', c.phone, 'whatsapp', c.whatsapp, 'has_login', c.owner_id is not null, 'created_at', c.created_at,
        'businesses', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', b.id, 'name', b.name, 'is_pro', public.business_is_pro(b.id),
            'plates', (select count(*) from public.plates p where p.business_id = b.id),
            'total_scans', coalesce((select sum(p.total_scans) from public.plates p where p.business_id = b.id), 0),
            'last_scan_at', (select max(p.last_scan_at) from public.plates p where p.business_id = b.id)
          ) order by b.created_at)
          from public.businesses b where b.company_id = c.id), '[]'::jsonb)
      ) order by c.created_at desc)
      from page c), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.admin_list_customers(text, int, int) from public, anon;
grant execute on function public.admin_list_customers(text, int, int) to authenticated;

-- Everything about one customer, in one call.
create or replace function public.admin_get_customer(p_company_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'company', to_jsonb(c) || jsonb_build_object('has_login', c.owner_id is not null),
    'businesses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'name', b.name, 'address', b.address, 'review_url', b.review_url, 'slug', b.slug,
        'created_at', b.created_at, 'is_pro', public.business_is_pro(b.id),
        'subscriptions', coalesce((
          select jsonb_agg(to_jsonb(s) order by s.created_at desc)
            from public.subscriptions s where s.business_id = b.id), '[]'::jsonb),
        'plates', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', p.id, 'code', p.code, 'label', p.label, 'active', p.active, 'destination_url', p.destination_url,
            'total_scans', p.total_scans, 'last_scan_at', p.last_scan_at, 'created_at', p.created_at) order by p.created_at)
            from public.plates p where p.business_id = b.id), '[]'::jsonb)
      ) order by b.created_at)
      from public.businesses b where b.company_id = c.id), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
        select pay.* from public.payments pay
          join public.businesses b on b.id = pay.business_id
         where b.company_id = c.id order by pay.created_at desc limit 50) x), '[]'::jsonb),
    'support', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
        select r.* from public.support_requests r where r.company_id = c.id order by r.created_at desc limit 20) x), '[]'::jsonb),
    'audit', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
        select a.id, a.action, a.entity, a.detail, a.created_at from public.audit_log a
         where (a.entity = 'company' and a.entity_id = c.id)
            or (a.entity = 'business' and a.entity_id in (select id from public.businesses where company_id = c.id))
         order by a.created_at desc limit 30) x), '[]'::jsonb)
  ) into v_result
  from public.companies c where c.id = p_company_id;
  return v_result;
end;
$$;
revoke all on function public.admin_get_customer(uuid) from public, anon;
grant execute on function public.admin_get_customer(uuid) to authenticated;

-- All plates with their location and customer (search by code, location or email).
create or replace function public.admin_list_plates(p_search text default null, p_limit int default 100, p_offset int default 0)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_q text := nullif(lower(trim(coalesce(p_search, ''))), '');
  v_like text;
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  v_like := '%' || replace(replace(replace(coalesce(v_q, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  with matched as materialized (
    select p.id, p.code, p.label, p.active, p.destination_url, p.total_scans, p.last_scan_at, p.created_at,
           b.id as business_id, b.name as business_name, c.id as company_id, c.name as company_name, c.owner_email
      from public.plates p
      join public.businesses b on b.id = p.business_id
      join public.companies c on c.id = b.company_id
     where v_q is null or lower(p.code) like v_like or lower(b.name) like v_like
        or lower(c.name) like v_like or lower(coalesce(c.owner_email, '')) like v_like
        or lower(coalesce(p.label, '')) like v_like
  )
  select jsonb_build_object(
    'total', (select count(*) from matched),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
        select * from matched order by created_at desc
         limit least(greatest(coalesce(p_limit, 100), 1), 500) offset greatest(coalesce(p_offset, 0), 0)) x), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.admin_list_plates(text, int, int) from public, anon;
grant execute on function public.admin_list_plates(text, int, int) to authenticated;

-- Subscriptions with their location and customer, live ones first.
create or replace function public.admin_list_subscriptions(p_limit int default 200) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x)) from (
      select s.id, s.status, s.provider, s.billing_interval, s.current_period_start, s.current_period_end,
             s.cancel_at_period_end, s.canceled_at, s.ended_at, s.created_at, s.provider_subscription_id,
             b.id as business_id, b.name as business_name, c.id as company_id, c.name as company_name, c.owner_email,
             public.business_is_pro(b.id) as is_pro
        from public.subscriptions s
        join public.businesses b on b.id = s.business_id
        join public.companies c on c.id = b.company_id
       order by (s.status in ('trialing', 'active', 'past_due')) desc, s.created_at desc
       limit least(greatest(coalesce(p_limit, 200), 1), 1000)) x), '[]'::jsonb);
end;
$$;
revoke all on function public.admin_list_subscriptions(int) from public, anon;
grant execute on function public.admin_list_subscriptions(int) to authenticated;

-- Headline numbers for the admin home page.
create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz constant text := 'Asia/Kuala_Lumpur';
  v_today date := (now() at time zone v_tz)::date;
  v_t0 timestamptz := (v_today::timestamp) at time zone v_tz;
  v_t7 timestamptz := ((v_today - 6)::timestamp) at time zone v_tz;
  v_t30 timestamptz := ((v_today - 29)::timestamp) at time zone v_tz;
begin
  if not public.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'companies', (select count(*) from public.companies),
    'businesses', (select count(*) from public.businesses),
    'plates', (select count(*) from public.plates),
    'plates_active', (select count(*) from public.plates where active),
    'pro_locations', (select count(*) from public.businesses b where public.business_is_pro(b.id)),
    'pro_paid', (select count(*) from public.subscriptions where provider <> 'manual' and status in ('trialing', 'active', 'past_due')),
    'past_due', (select count(*) from public.subscriptions where status = 'past_due'),
    'open_support', (select count(*) from public.support_requests where status = 'open'),
    'scans_total', (select coalesce(sum(total_scans), 0) from public.plates),
    'scans_today', (select count(*) from public.scans where created_at >= v_t0),
    'scans_7d', (select count(*) from public.scans where created_at >= v_t7),
    'scans_30d', (select count(*) from public.scans where created_at >= v_t30)
  );
end;
$$;
revoke all on function public.admin_overview() from public, anon;
grant execute on function public.admin_overview() to authenticated;

-- ------------------------------------------------------------
-- Daily maintenance (called by the Vercel cron with the service role).
-- ------------------------------------------------------------
create or replace function public.maintenance_daily() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_expired int;
  v_purged int;
  v_stale int;
begin
  -- Subscriptions whose paid / granted period is over (manual end dates, or a scheduled
  -- cancellation whose final webhook never arrived).
  update public.subscriptions
     set status = 'canceled', canceled_at = coalesce(canceled_at, now()), ended_at = now()
   where status in ('trialing', 'active', 'past_due')
     and current_period_end is not null
     and (
       (provider = 'manual' and current_period_end <= now())
       or (provider <> 'manual' and cancel_at_period_end and current_period_end + interval '3 days' <= now())
       or (provider <> 'manual' and current_period_end + interval '15 days' <= now())
     );
  get diagnostics v_expired = row_count;

  -- The device fingerprint is only needed for a few seconds: erase it after two days.
  update public.scans set device_hash = null
   where device_hash is not null and created_at < now() - interval '2 days';
  get diagnostics v_purged = row_count;

  -- Checkouts that were opened but never paid.
  delete from public.subscriptions where status = 'incomplete' and created_at < now() - interval '2 days';
  get diagnostics v_stale = row_count;

  return jsonb_build_object('expired_subscriptions', v_expired, 'purged_device_hashes', v_purged, 'stale_checkouts', v_stale);
end;
$$;
revoke all on function public.maintenance_daily() from public, anon, authenticated;
grant execute on function public.maintenance_daily() to service_role;

-- Row level security does not cover TRUNCATE, and nothing in the app needs these three rights.
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

notify pgrst, 'reload schema';

commit;
