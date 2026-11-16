import { describe, it, expect, beforeAll } from 'vitest';
import { createDb, createUser, makeAdmin, asUser, asAnon, asService, rpc, rejected } from '../helpers/db.js';
import { klDateKey, addDays, isoWeekday } from '../../lib/time.js';

const LINK = 'https://g.page/r/kopi/review';

async function setup() {
  const db = await createDb();
  const admin = await createUser(db, 'admin@reviewlah.my');
  await makeAdmin(db, admin);
  const owner = await createUser(db, 'owner@kopi.my');
  const bundle = await asUser(db, admin, (tx) => rpc(tx, 'admin_create_bundle', {
    p_company_name: 'Kopi Corner Sdn Bhd', p_owner_email: 'owner@kopi.my', p_contact_name: 'Aisha', p_phone: '+60123456789',
    p_business_name: 'Kopi Corner Bangsar', p_address: 'Bangsar, KL', p_review_url: LINK,
    p_plate_count: 2, p_plate_label: null, p_pro: true, p_pro_until: null, p_company_id: null,
  }));
  return { db, admin, owner, bundle, codes: bundle.plates.map((p) => p.code), plateIds: bundle.plates.map((p) => p.id) };
}

describe('record_scan (the plate redirect)', () => {
  let ctx;
  beforeAll(async () => { ctx = await setup(); });

  it('returns the Google link for anyone, in any letter case, and counts the scan', async () => {
    const [code] = ctx.codes;
    const url = await asAnon(ctx.db, (tx) => rpc(tx, 'record_scan', { p_code: ` ${code.toLowerCase()} `, p_source: 'nfc', p_device: null }));
    expect(url).toBe(LINK);
    const { rows } = await ctx.db.query('select total_scans, last_scan_at from public.plates where code = $1', [code]);
    expect(Number(rows[0].total_scans)).toBe(1);
    expect(rows[0].last_scan_at).toBeTruthy();
  });

  it('counts an immediate second tap from the same device only once, but still redirects', async () => {
    const [, code] = ctx.codes;
    const tap = (device, source = 'nfc') => asAnon(ctx.db, (tx) => rpc(tx, 'record_scan', { p_code: code, p_source: source, p_device: device }));
    expect(await tap('device-a')).toBe(LINK);
    expect(await tap('device-a')).toBe(LINK);
    expect(await tap('device-a', 'qr')).toBe(LINK);
    expect(await tap('device-b')).toBe(LINK); // another phone at the same moment is a real scan
    const count = async () => Number((await ctx.db.query('select total_scans from public.plates where code = $1', [code])).rows[0].total_scans);
    expect(await count()).toBe(2);

    // The same phone coming back later counts again.
    await ctx.db.query("update public.scans set created_at = created_at - interval '20 seconds' where plate_id = $1", [ctx.plateIds[1]]);
    expect(await tap('device-a')).toBe(LINK);
    expect(await count()).toBe(3);
  });

  it('never stores what the app sent: the fingerprint is salted again inside the database', async () => {
    const { rows } = await ctx.db.query('select device_hash from public.scans where device_hash is not null');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.device_hash).toMatch(/^[0-9a-f]{32}$/);
      expect(row.device_hash).not.toContain('device');
    }
    const salt = await rejected(asAnon(ctx.db, (tx) => tx.query('select * from public.private_settings')));
    expect(salt.message).toMatch(/permission denied/);
    const visible = await rejected(asUser(ctx.db, ctx.owner, (tx) => tx.query('select * from public.private_settings')));
    expect(visible.message).toMatch(/permission denied/);
  });

  it('erases fingerprints after two days (daily maintenance)', async () => {
    await ctx.db.query("update public.scans set created_at = created_at - interval '3 days' where device_hash is not null");
    const result = await asService(ctx.db, (tx) => rpc(tx, 'maintenance_daily'));
    expect(result.purged_device_hashes).toBeGreaterThan(0);
    expect((await ctx.db.query('select count(*)::int as n from public.scans where device_hash is not null')).rows[0].n).toBe(0);
  });

  it('sends unknown and paused plates nowhere, and does not count them', async () => {
    expect(await asAnon(ctx.db, (tx) => rpc(tx, 'record_scan', { p_code: 'NOPE1', p_source: 'nfc', p_device: null }))).toBeNull();
    const [code] = ctx.codes;
    await ctx.db.query('update public.plates set active = false where code = $1', [code]);
    const before = (await ctx.db.query('select count(*)::int as n from public.scans')).rows[0].n;
    expect(await asAnon(ctx.db, (tx) => rpc(tx, 'record_scan', { p_code: code, p_source: 'nfc', p_device: null }))).toBeNull();
    expect(await asAnon(ctx.db, (tx) => rpc(tx, 'plate_destination', { p_code: code }))).toBeNull();
    expect((await ctx.db.query('select count(*)::int as n from public.scans')).rows[0].n).toBe(before);
    await ctx.db.query('update public.plates set active = true where code = $1', [code]);
  });

  it('gives the destination without counting for previews (plate_destination)', async () => {
    const [code] = ctx.codes;
    const before = (await ctx.db.query('select count(*)::int as n from public.scans')).rows[0].n;
    expect(await asAnon(ctx.db, (tx) => rpc(tx, 'plate_destination', { p_code: code }))).toBe(LINK);
    expect((await ctx.db.query('select count(*)::int as n from public.scans')).rows[0].n).toBe(before);
  });

  it('still redirects when counting fails', async () => {
    const [code] = ctx.codes;
    await ctx.db.exec('alter table public.scans add constraint scans_block check (source <> \'qr\') not valid');
    try {
      const url = await asAnon(ctx.db, (tx) => rpc(tx, 'record_scan', { p_code: code, p_source: 'qr', p_device: null }));
      expect(url).toBe(LINK);
    } finally {
      await ctx.db.exec('alter table public.scans drop constraint scans_block');
    }
  });
});

describe('scan statistics in Malaysia time', () => {
  let ctx;
  let today;
  const klMidnight = (key) => new Date(`${key}T00:00:00+08:00`);
  const at = (key, time) => new Date(`${key}T${time}+08:00`).toISOString();

  beforeAll(async () => {
    ctx = await setup();
    today = klDateKey();
    const [p1, p2] = ctx.plateIds;
    const y = addDays(today, -1);
    const d2 = addDays(today, -2);
    const scans = [
      // Yesterday in Kuala Lumpur. 00:30 KL is still the day before in UTC: it must count for yesterday.
      [p1, 'nfc', at(y, '00:30:00')],
      [p1, 'nfc', at(y, '12:15:00')],
      [p2, 'qr', at(y, '23:59:59')],
      // Two days ago, one second before midnight KL.
      [p1, 'qr', at(d2, '23:59:59')],
      // Previous 7-day window (8 and 13 days ago).
      [p1, 'nfc', at(addDays(today, -8), '09:00:00')],
      [p2, 'other', at(addDays(today, -13), '18:00:00')],
      // Outside both 7-day windows, inside the 30-day one.
      [p1, 'nfc', at(addDays(today, -20), '10:00:00')],
      // 45 days ago: previous 30-day window.
      [p1, 'qr', at(addDays(today, -45), '10:00:00')],
    ];
    for (const [plate, source, ts] of scans) {
      await ctx.db.query('insert into public.scans (plate_id, source, created_at) values ($1, $2, $3)', [plate, source, ts]);
    }
    expect(klMidnight(today).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('buckets days on the Kuala Lumpur calendar and compares with the previous period', async () => {
    const stats = await asUser(ctx.db, ctx.owner, async (tx) => {
      await rpc(tx, 'claim_account');
      return rpc(tx, 'scan_stats', { p_business_id: ctx.bundle.business_id, p_days: 7, p_plate_id: null });
    });
    expect(stats.days).toBe(7);
    expect(stats.end).toBe(today);
    expect(stats.start).toBe(addDays(today, -6));
    expect(stats.prev_start).toBe(addDays(today, -13));
    expect(stats.prev_end).toBe(addDays(today, -7));
    expect(stats.daily).toHaveLength(7);
    expect(stats.daily.map((d) => d.d)).toEqual(Array.from({ length: 7 }, (_, i) => addDays(today, i - 6)));
    const byDay = Object.fromEntries(stats.daily.map((d) => [d.d, d]));
    expect(byDay[addDays(today, -1)]).toMatchObject({ total: 3, nfc: 2, qr: 1 });
    expect(byDay[addDays(today, -2)]).toMatchObject({ total: 1, nfc: 0, qr: 1 });
    expect(byDay[today].total).toBe(0);
    expect(stats.total).toBe(4);
    expect(stats.nfc).toBe(2);
    expect(stats.qr).toBe(2);
    expect(stats.prev).toMatchObject({ total: 2, nfc: 1, qr: 0, other: 1 });
  });

  it('reports hours and weekdays as they were on a clock in Kuala Lumpur', async () => {
    const stats = await asUser(ctx.db, ctx.owner, (tx) => rpc(tx, 'scan_stats', { p_business_id: ctx.bundle.business_id, p_days: 7, p_plate_id: null }));
    expect(stats.hours).toHaveLength(24);
    expect(stats.hours[0]).toBe(1); // 00:30
    expect(stats.hours[12]).toBe(1); // 12:15
    expect(stats.hours[23]).toBe(2); // 23:59 twice
    expect(stats.hours.reduce((a, b) => a + b, 0)).toBe(4);
    expect(stats.weekdays).toHaveLength(7);
    const expected = new Array(7).fill(0);
    expected[isoWeekday(addDays(today, -1)) - 1] += 3;
    expected[isoWeekday(addDays(today, -2)) - 1] += 1;
    expect(stats.weekdays).toEqual(expected);
  });

  it('supports 30 and 90 days, a plate filter, and a 12-month series', async () => {
    const run = (days, plate = null) => asUser(ctx.db, ctx.owner, (tx) => rpc(tx, 'scan_stats', { p_business_id: ctx.bundle.business_id, p_days: days, p_plate_id: plate }));
    const d30 = await run(30);
    expect(d30.total).toBe(7);
    expect(d30.prev.total).toBe(1);
    expect(d30.daily).toHaveLength(30);
    const d90 = await run(90);
    expect(d90.total).toBe(8);
    expect(d90.daily).toHaveLength(90);
    expect(d90.monthly).toHaveLength(12);
    expect(d90.monthly.at(-1).m).toBe(`${today.slice(0, 7)}-01`);
    expect(d90.monthly.reduce((sum, m) => sum + m.total, 0)).toBe(8);
    const onePlate = await run(30, ctx.plateIds[1]);
    expect(onePlate.total).toBe(2);
    expect(onePlate.plates).toHaveLength(2); // the per-plate table always lists every plate
    expect(onePlate.plates.find((p) => p.id === ctx.plateIds[0]).total).toBe(5);
    expect((await run(12)).days).toBe(30); // anything else falls back to 30 days
  });

  it('refuses another customer, and refuses a Basic location', async () => {
    const stranger = await createUser(ctx.db, 'stranger@example.com');
    const denied = await rejected(asUser(ctx.db, stranger, (tx) => rpc(tx, 'scan_stats', { p_business_id: ctx.bundle.business_id, p_days: 7, p_plate_id: null })));
    expect(denied.message).toMatch(/not_allowed/);
    await asUser(ctx.db, ctx.admin, (tx) => rpc(tx, 'admin_set_pro', { p_business_id: ctx.bundle.business_id, p_enabled: false, p_until: null }));
    const basic = await rejected(asUser(ctx.db, ctx.owner, (tx) => rpc(tx, 'scan_stats', { p_business_id: ctx.bundle.business_id, p_days: 7, p_plate_id: null })));
    expect(basic.message).toMatch(/pro_required/);
    // Basic owners cannot read scan rows either: only the counters on their plates.
    const rows = await asUser(ctx.db, ctx.owner, (tx) => tx.query('select count(*)::int as n from public.scans'));
    expect(rows.rows[0].n).toBe(0);
    const plates = await asUser(ctx.db, ctx.owner, (tx) => tx.query('select sum(total_scans)::int as n from public.plates'));
    expect(plates.rows[0].n).toBe(0); // counters only move through record_scan; rows above were inserted directly
    await asUser(ctx.db, ctx.admin, (tx) => rpc(tx, 'admin_set_pro', { p_business_id: ctx.bundle.business_id, p_enabled: true, p_until: null }));
  });

  it('exports scans in Malaysia time, page by page', async () => {
    const from = addDays(today, -2);
    const page = (after, limit) => asUser(ctx.db, ctx.owner, (tx) => tx.query(
      'select * from public.export_scans($1, $2, $3, $4, $5)', [ctx.bundle.business_id, from, today, after, limit]));
    const first = await page(0, 3);
    expect(first.rows).toHaveLength(3);
    const second = await page(first.rows.at(-1).scan_id, 3);
    expect(second.rows).toHaveLength(1);
    const all = [...first.rows, ...second.rows];
    expect(all.map((r) => r.scan_time).sort()).toEqual(['00:30:00', '12:15:00', '23:59:59', '23:59:59']);
    expect(all.every((r) => r.scanned_at.endsWith('+08:00'))).toBe(true);
    expect(new Set(all.map((r) => r.scan_date))).toEqual(new Set([addDays(today, -1), addDays(today, -2)]));
  });

  it('compares locations and plates side by side', async () => {
    const compare = await asUser(ctx.db, ctx.owner, (tx) => rpc(tx, 'scan_compare', { p_days: 7 }));
    expect(compare.locations).toHaveLength(1);
    expect(compare.locations[0]).toMatchObject({ total: 4, prev: 2, nfc: 2, qr: 2, is_pro: true });
    expect(compare.locations[0].plates.map((p) => p.total)).toEqual([3, 1]);
  });

  it('builds the monthly summary on Kuala Lumpur month boundaries (service role only)', async () => {
    const month = `${today.slice(0, 7)}-01`;
    const first = at(month, '00:00:30'); // first minute of the month in KL = previous month in UTC
    await ctx.db.query("insert into public.scans (plate_id, source, created_at) values ($1, 'nfc', $2)", [ctx.plateIds[0], first]);
    const data = await asService(ctx.db, (tx) => rpc(tx, 'monthly_summary_data', { p_month: month }));
    expect(data).toHaveLength(1);
    expect(data[0].email).toBe('owner@kopi.my');
    const location = data[0].businesses[0];
    const inMonth = (await ctx.db.query(
      "select count(*)::int as n from public.scans where (created_at at time zone 'Asia/Kuala_Lumpur') >= $1::date and (created_at at time zone 'Asia/Kuala_Lumpur') < ($1::date + interval '1 month')", [month])).rows[0].n;
    expect(location.total).toBe(inMonth);
    expect(location.total).toBeGreaterThanOrEqual(1);
    const denied = await rejected(asUser(ctx.db, ctx.owner, (tx) => rpc(tx, 'monthly_summary_data', { p_month: month })));
    expect(denied.message).toMatch(/permission denied/);
  });
});
