-- ReviewLah — migration 0002: dashboard data and scan statistics, computed in SQL.
-- Every day / hour / weekday / month bucket uses the Asia/Kuala_Lumpur time zone.
-- Idempotent (create or replace only).

begin;

-- ------------------------------------------------------------
-- dashboard_bootstrap(): one call per page load. Attaches the account to the signed-in user,
-- then returns the account, its locations, plates, plan and counters. No scan rows are read
-- for Basic locations.
-- ------------------------------------------------------------
create or replace function public.dashboard_bootstrap() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_tz constant text := 'Asia/Kuala_Lumpur';
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone v_tz)::date;
  v_t7 timestamptz := ((v_today - 6)::timestamp) at time zone v_tz;
  v_t14 timestamptz := ((v_today - 13)::timestamp) at time zone v_tz;
  v_t30 timestamptz := ((v_today - 29)::timestamp) at time zone v_tz;
  v_t60 timestamptz := ((v_today - 59)::timestamp) at time zone v_tz;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  perform public.claim_account();

  select jsonb_build_object(
    'user_id', v_uid,
    'email', auth.jwt() ->> 'email',
    'is_admin', public.is_admin(),
    'today', v_today,
    'companies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'owner_email', c.owner_email, 'contact_name', c.contact_name,
        'phone', c.phone, 'whatsapp', c.whatsapp,
        'email_monthly_summary', c.email_monthly_summary, 'email_review_alerts', c.email_review_alerts
      ) order by c.created_at)
      from public.companies c where c.owner_id = v_uid), '[]'::jsonb),
    'businesses', coalesce((
      select jsonb_agg(x.obj order by x.created_at)
      from (
        select b.created_at, jsonb_build_object(
          'id', b.id, 'company_id', b.company_id, 'name', b.name, 'address', b.address,
          'review_url', b.review_url, 'slug', b.slug,
          'is_pro', pro.is_pro,
          'subscription', (
            select jsonb_build_object(
              'id', s.id, 'status', s.status, 'billing_interval', s.billing_interval, 'provider', s.provider,
              'current_period_end', s.current_period_end, 'cancel_at_period_end', s.cancel_at_period_end,
              'canceled_at', s.canceled_at)
            from public.subscriptions s
            where s.business_id = b.id and s.status <> 'incomplete'
            order by (s.status in ('trialing', 'active', 'past_due')) desc, s.created_at desc
            limit 1),
          'total_scans', coalesce((select sum(p.total_scans) from public.plates p where p.business_id = b.id), 0),
          'last_scan_at', (select max(p.last_scan_at) from public.plates p where p.business_id = b.id),
          'plates', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', p.id, 'code', p.code, 'label', p.label, 'active', p.active,
              'destination_url', p.destination_url, 'total_scans', p.total_scans,
              'last_scan_at', p.last_scan_at, 'created_at', p.created_at
            ) order by p.created_at)
            from public.plates p where p.business_id = b.id), '[]'::jsonb),
          'recent', case when pro.is_pro then (
            select jsonb_build_object(
              'd7', count(*) filter (where sc.created_at >= v_t7),
              'd7_prev', count(*) filter (where sc.created_at >= v_t14 and sc.created_at < v_t7),
              'd30', count(*) filter (where sc.created_at >= v_t30),
              'd30_prev', count(*) filter (where sc.created_at < v_t30))
            from public.scans sc
            join public.plates p on p.id = sc.plate_id
            where p.business_id = b.id and sc.created_at >= v_t60) end
        ) as obj
        from public.businesses b
        join public.companies c on c.id = b.company_id
        cross join lateral (select public.business_is_pro(b.id) as is_pro) pro
        where c.owner_id = v_uid
      ) x), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.dashboard_bootstrap() from public, anon;
grant execute on function public.dashboard_bootstrap() to authenticated;

-- ------------------------------------------------------------
-- scan_stats(): Pro analytics for one location (optionally one plate), for the last 7 / 30 / 90
-- days including today, compared with the same number of days just before.
-- ------------------------------------------------------------
create or replace function public.scan_stats(p_business_id uuid, p_days int default 30, p_plate_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz constant text := 'Asia/Kuala_Lumpur';
  v_days int := case when p_days in (7, 30, 90) then p_days else 30 end;
  v_today date := (now() at time zone v_tz)::date;
  v_start date := v_today - (v_days - 1);
  v_prev_start date := v_start - v_days;
  v_from timestamptz := (v_start::timestamp) at time zone v_tz;
  v_prev_from timestamptz := (v_prev_start::timestamp) at time zone v_tz;
  v_to timestamptz := ((v_today + 1)::timestamp) at time zone v_tz;
  v_month_start date := (date_trunc('month', v_today::timestamp) - interval '11 months')::date;
  v_month_from timestamptz := (v_month_start::timestamp) at time zone v_tz;
  v_result jsonb;
begin
  if not (public.is_admin() or public.owns_business(p_business_id)) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if not (public.is_admin() or public.business_is_pro(p_business_id)) then
    raise exception 'pro_required' using errcode = 'P0001';
  end if;

  with base as materialized (
    select sc.created_at, sc.source, sc.plate_id, (sc.created_at at time zone v_tz) as local_ts
      from public.scans sc
      join public.plates p on p.id = sc.plate_id
     where p.business_id = p_business_id
       and sc.created_at >= least(v_prev_from, v_month_from)
       and sc.created_at < v_to
  ),
  sel as (select * from base where p_plate_id is null or plate_id = p_plate_id),
  cur as (select * from sel where created_at >= v_from),
  prev as (select * from sel where created_at >= v_prev_from and created_at < v_from)
  select jsonb_build_object(
    'days', v_days,
    'start', v_start, 'end', v_today,
    'prev_start', v_prev_start, 'prev_end', v_start - 1,
    'plate_id', p_plate_id,
    'total', (select count(*) from cur),
    'nfc', (select count(*) from cur where source = 'nfc'),
    'qr', (select count(*) from cur where source = 'qr'),
    'other', (select count(*) from cur where source not in ('nfc', 'qr')),
    'prev', (select jsonb_build_object(
      'total', count(*),
      'nfc', count(*) filter (where source = 'nfc'),
      'qr', count(*) filter (where source = 'qr'),
      'other', count(*) filter (where source not in ('nfc', 'qr'))) from prev),
    'daily', (
      select jsonb_agg(jsonb_build_object(
        'd', g.d::date, 'total', coalesce(a.total, 0), 'nfc', coalesce(a.nfc, 0),
        'qr', coalesce(a.qr, 0), 'other', coalesce(a.other, 0)) order by g.d)
      from generate_series(v_start::timestamp, v_today::timestamp, interval '1 day') as g(d)
      left join (
        select local_ts::date as day, count(*) as total,
               count(*) filter (where source = 'nfc') as nfc,
               count(*) filter (where source = 'qr') as qr,
               count(*) filter (where source not in ('nfc', 'qr')) as other
          from cur group by 1) a on a.day = g.d::date),
    'monthly', (
      select jsonb_agg(jsonb_build_object(
        'm', g.m::date, 'total', coalesce(a.total, 0), 'nfc', coalesce(a.nfc, 0),
        'qr', coalesce(a.qr, 0), 'other', coalesce(a.other, 0)) order by g.m)
      from generate_series(v_month_start::timestamp, date_trunc('month', v_today::timestamp), interval '1 month') as g(m)
      left join (
        select date_trunc('month', local_ts)::date as month, count(*) as total,
               count(*) filter (where source = 'nfc') as nfc,
               count(*) filter (where source = 'qr') as qr,
               count(*) filter (where source not in ('nfc', 'qr')) as other
          from sel where created_at >= v_month_from group by 1) a on a.month = g.m::date),
    'hours', (
      select jsonb_agg(coalesce(a.n, 0) order by g.h)
      from generate_series(0, 23) as g(h)
      left join (select extract(hour from local_ts)::int as h, count(*) as n from cur group by 1) a on a.h = g.h),
    'weekdays', (
      select jsonb_agg(coalesce(a.n, 0) order by g.wd)
      from generate_series(1, 7) as g(wd)
      left join (select extract(isodow from local_ts)::int as wd, count(*) as n from cur group by 1) a on a.wd = g.wd),
    'plates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'code', p.code, 'label', p.label, 'active', p.active,
        'total', coalesce(a.total, 0), 'prev', coalesce(a.prev, 0),
        'nfc', coalesce(a.nfc, 0), 'qr', coalesce(a.qr, 0)) order by coalesce(a.total, 0) desc, p.created_at)
      from public.plates p
      left join (
        select plate_id,
               count(*) filter (where created_at >= v_from) as total,
               count(*) filter (where created_at >= v_prev_from and created_at < v_from) as prev,
               count(*) filter (where created_at >= v_from and source = 'nfc') as nfc,
               count(*) filter (where created_at >= v_from and source = 'qr') as qr
          from base group by plate_id) a on a.plate_id = p.id
      where p.business_id = p_business_id), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.scan_stats(uuid, int, uuid) from public, anon;
grant execute on function public.scan_stats(uuid, int, uuid) to authenticated, service_role;

-- ------------------------------------------------------------
-- scan_compare(): all the caller's locations side by side (Pro locations only carry numbers).
-- ------------------------------------------------------------
create or replace function public.scan_compare(p_days int default 30)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz constant text := 'Asia/Kuala_Lumpur';
  v_uid uuid := auth.uid();
  v_days int := case when p_days in (7, 30, 90) then p_days else 30 end;
  v_today date := (now() at time zone v_tz)::date;
  v_start date := v_today - (v_days - 1);
  v_prev_start date := v_start - v_days;
  v_from timestamptz := (v_start::timestamp) at time zone v_tz;
  v_prev_from timestamptz := (v_prev_start::timestamp) at time zone v_tz;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  with mine as materialized (
    select b.id, b.name, b.created_at, public.business_is_pro(b.id) as is_pro
      from public.businesses b
      join public.companies c on c.id = b.company_id
     where c.owner_id = v_uid
  ),
  agg as materialized (
    select p.business_id, p.id as plate_id,
           count(*) filter (where sc.created_at >= v_from) as total,
           count(*) filter (where sc.created_at < v_from) as prev,
           count(*) filter (where sc.created_at >= v_from and sc.source = 'nfc') as nfc,
           count(*) filter (where sc.created_at >= v_from and sc.source = 'qr') as qr
      from public.scans sc
      join public.plates p on p.id = sc.plate_id
      join mine m on m.id = p.business_id and m.is_pro
     where sc.created_at >= v_prev_from
     group by p.business_id, p.id
  )
  select jsonb_build_object(
    'days', v_days, 'start', v_start, 'end', v_today, 'prev_start', v_prev_start, 'prev_end', v_start - 1,
    'locations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'name', m.name, 'is_pro', m.is_pro,
        'total', case when m.is_pro then coalesce((select sum(a.total) from agg a where a.business_id = m.id), 0) end,
        'prev', case when m.is_pro then coalesce((select sum(a.prev) from agg a where a.business_id = m.id), 0) end,
        'nfc', case when m.is_pro then coalesce((select sum(a.nfc) from agg a where a.business_id = m.id), 0) end,
        'qr', case when m.is_pro then coalesce((select sum(a.qr) from agg a where a.business_id = m.id), 0) end,
        'plates', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', p.id, 'code', p.code, 'label', p.label, 'active', p.active,
            'total', case when m.is_pro then coalesce(a.total, 0) end,
            'prev', case when m.is_pro then coalesce(a.prev, 0) end,
            'nfc', case when m.is_pro then coalesce(a.nfc, 0) end,
            'qr', case when m.is_pro then coalesce(a.qr, 0) end) order by coalesce(a.total, 0) desc, p.created_at)
          from public.plates p
          left join agg a on a.plate_id = p.id
          where p.business_id = m.id), '[]'::jsonb)
      ) order by m.created_at)
      from mine m), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.scan_compare(int) from public, anon;
grant execute on function public.scan_compare(int) to authenticated;

-- ------------------------------------------------------------
-- export_scans(): raw scan rows for the CSV export, in Malaysia time, read in pages (keyset on id).
-- ------------------------------------------------------------
create or replace function public.export_scans(
  p_business_id uuid, p_from date, p_to date, p_after bigint default 0, p_limit int default 1000
) returns table (
  scan_id bigint, scanned_at text, scan_date text, scan_time text, weekday text,
  plate_code text, plate_label text, source text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz constant text := 'Asia/Kuala_Lumpur';
begin
  if not (public.is_admin() or public.owns_business(p_business_id)) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if not (public.is_admin() or public.business_is_pro(p_business_id)) then
    raise exception 'pro_required' using errcode = 'P0001';
  end if;
  return query
    select sc.id,
           to_char(sc.created_at at time zone v_tz, 'YYYY-MM-DD"T"HH24:MI:SS') || '+08:00',
           to_char(sc.created_at at time zone v_tz, 'YYYY-MM-DD'),
           to_char(sc.created_at at time zone v_tz, 'HH24:MI:SS'),
           trim(to_char(sc.created_at at time zone v_tz, 'Day')),
           p.code, p.label, sc.source
      from public.scans sc
      join public.plates p on p.id = sc.plate_id
     where p.business_id = p_business_id
       and sc.id > coalesce(p_after, 0)
       and sc.created_at >= (p_from::timestamp) at time zone v_tz
       and sc.created_at < ((p_to + 1)::timestamp) at time zone v_tz
     order by sc.id
     limit least(greatest(coalesce(p_limit, 1000), 1), 5000);
end;
$$;
revoke all on function public.export_scans(uuid, date, date, bigint, int) from public, anon;
grant execute on function public.export_scans(uuid, date, date, bigint, int) to authenticated;

-- ------------------------------------------------------------
-- monthly_summary_data(): figures for the monthly email, one entry per company with at least
-- one Pro location. Server-side only (service role).
-- ------------------------------------------------------------
create or replace function public.monthly_summary_data(p_month date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz constant text := 'Asia/Kuala_Lumpur';
  v_month date := date_trunc('month', p_month::timestamp)::date;
  v_next date := (v_month + interval '1 month')::date;
  v_prev date := (v_month - interval '1 month')::date;
  v_from timestamptz := (v_month::timestamp) at time zone v_tz;
  v_to timestamptz := (v_next::timestamp) at time zone v_tz;
  v_prev_from timestamptz := (v_prev::timestamp) at time zone v_tz;
  v_result jsonb;
begin
  with pro as materialized (
    select b.id, b.name, b.company_id, b.created_at
      from public.businesses b
     where public.business_is_pro(b.id)
  ),
  sc as materialized (
    select p.business_id, p.id as plate_id, s.source, s.created_at, (s.created_at at time zone v_tz) as local_ts
      from public.scans s
      join public.plates p on p.id = s.plate_id
      join pro on pro.id = p.business_id
     where s.created_at >= v_prev_from and s.created_at < v_to
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'company_id', c.id, 'company_name', c.name, 'email', c.owner_email, 'contact_name', c.contact_name,
    'month', v_month,
    'businesses', (
      select jsonb_agg(jsonb_build_object(
        'id', pro.id, 'name', pro.name,
        'total', (select count(*) from sc where sc.business_id = pro.id and sc.created_at >= v_from),
        'prev_total', (select count(*) from sc where sc.business_id = pro.id and sc.created_at < v_from),
        'nfc', (select count(*) from sc where sc.business_id = pro.id and sc.created_at >= v_from and sc.source = 'nfc'),
        'qr', (select count(*) from sc where sc.business_id = pro.id and sc.created_at >= v_from and sc.source = 'qr'),
        'best_day', (
          select jsonb_build_object('d', x.d, 'n', x.n) from (
            select local_ts::date as d, count(*) as n from sc
             where sc.business_id = pro.id and sc.created_at >= v_from group by 1 order by 2 desc, 1 limit 1) x),
        'peak_hour', (
          select x.h from (
            select extract(hour from local_ts)::int as h, count(*) as n from sc
             where sc.business_id = pro.id and sc.created_at >= v_from group by 1 order by 2 desc, 1 limit 1) x),
        'peak_weekday', (
          select x.wd from (
            select extract(isodow from local_ts)::int as wd, count(*) as n from sc
             where sc.business_id = pro.id and sc.created_at >= v_from group by 1 order by 2 desc, 1 limit 1) x),
        'all_time_total', coalesce((select sum(p.total_scans) from public.plates p where p.business_id = pro.id), 0),
        'plates', coalesce((
          select jsonb_agg(jsonb_build_object(
            'code', p.code, 'label', p.label,
            'total', (select count(*) from sc where sc.plate_id = p.id and sc.created_at >= v_from)) order by p.created_at)
          from public.plates p where p.business_id = pro.id), '[]'::jsonb)
      ) order by pro.created_at)
      from pro where pro.company_id = c.id)
  ) order by c.created_at), '[]'::jsonb)
  into v_result
  from public.companies c
  where c.owner_email is not null
    and c.email_monthly_summary
    and exists (select 1 from pro where pro.company_id = c.id);
  return v_result;
end;
$$;
revoke all on function public.monthly_summary_data(date) from public, anon, authenticated;
grant execute on function public.monthly_summary_data(date) to service_role;

notify pgrst, 'reload schema';

commit;
