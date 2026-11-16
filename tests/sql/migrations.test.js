import { describe, it, expect, beforeAll } from 'vitest';
import { createLegacyDb, applyMigrations, createUser, asUser, asAnon, rpc, rejected } from '../helpers/db.js';

// The exact shape production was in before migration 0001: one Pro plate created with the old admin,
// five scans, owner not logged in yet.
async function seedLegacy(db) {
  await db.exec(`
    insert into public.plates (id, code, business_name, owner_email, destination_url, plan, created_at)
    values ('7b0c1f0e-52a4-4c1e-9f0a-3d2b6a1e9c11', 'A7X92', 'Kopi Corner', 'Owner@Example.com',
            'https://search.google.com/local/writereview?placeid=ChIJEXAMPLEPLACEID0000', 'pro', '2026-11-08 09:22:54+00');
    insert into public.plates (code, business_name, owner_email, destination_url, plan)
    values ('BASIC', 'Salon Seri', 'salon@example.com', 'https://g.page/r/abc/review', 'basic'),
           ('KOPI2', 'Kopi Corner', 'owner@example.com', 'https://g.page/r/second/review', 'pro'),
           ('STOCK', 'Unassigned plate', null, 'https://g.page/r/stock/review', 'basic');
    insert into public.scans (plate_id, source, created_at)
    select '7b0c1f0e-52a4-4c1e-9f0a-3d2b6a1e9c11', 'other', ts
      from unnest(array['2026-11-08 09:23:30+00', '2026-11-08 09:30:11+00', '2026-11-08 09:33:09+00',
                        '2026-11-08 09:33:32+00', '2026-11-08 09:50:24+00']::timestamptz[]) ts;
  `);
}

describe('migrations on top of the legacy schema', () => {
  let db;
  beforeAll(async () => {
    db = await createLegacyDb();
    await seedLegacy(db);
    await applyMigrations(db);
  });

  it('keeps every plate and scan, and attaches each plate to a company and a location', async () => {
    const plates = (await db.query('select code, business_id, total_scans, last_scan_at, plan, owner_email from public.plates order by code')).rows;
    expect(plates.map((p) => p.code)).toEqual(['A7X92', 'BASIC', 'KOPI2', 'STOCK']);
    expect(plates.every((p) => p.business_id)).toBe(true);
    expect((await db.query('select count(*)::int as n from public.scans')).rows[0].n).toBe(5);
    const main = plates.find((p) => p.code === 'A7X92');
    expect(Number(main.total_scans)).toBe(5);
    expect(main.last_scan_at.toISOString()).toBe('2026-11-08T09:50:24.000Z');
    expect(main.plan).toBe('pro'); // legacy column untouched
  });

  it('groups plates with the same owner email and business name into one location', async () => {
    const { rows } = await db.query(`
      select c.owner_email, b.name, count(p.*)::int as plates
        from public.companies c join public.businesses b on b.company_id = c.id
        join public.plates p on p.business_id = b.id
       group by 1, 2 order by 2`);
    expect(rows).toEqual([
      { owner_email: 'owner@example.com', name: 'Kopi Corner', plates: 2 },
      { owner_email: 'salon@example.com', name: 'Salon Seri', plates: 1 },
      { owner_email: null, name: 'Unassigned plate', plates: 1 },
    ]);
  });

  it('turns plates.plan = pro into one manual subscription per location', async () => {
    const { rows } = await db.query(`
      select b.name, s.status, s.provider, public.business_is_pro(b.id) as is_pro
        from public.businesses b left join public.subscriptions s on s.business_id = b.id order by b.name`);
    expect(rows).toEqual([
      { name: 'Kopi Corner', status: 'active', provider: 'manual', is_pro: true },
      { name: 'Salon Seri', status: null, provider: null, is_pro: false },
      { name: 'Unassigned plate', status: null, provider: null, is_pro: false },
    ]);
  });

  it('is idempotent: running every migration again changes nothing', async () => {
    const snapshot = async () => ({
      companies: (await db.query('select id, name, owner_email from public.companies order by id')).rows,
      businesses: (await db.query('select id, name, slug, company_id from public.businesses order by id')).rows,
      plates: (await db.query('select id, code, business_id, total_scans from public.plates order by id')).rows,
      subscriptions: (await db.query('select id, business_id, status from public.subscriptions order by id')).rows,
      scans: (await db.query('select count(*)::int as n from public.scans')).rows,
    });
    const before = await snapshot();
    await applyMigrations(db);
    await applyMigrations(db);
    expect(await snapshot()).toEqual(before);
  });

  it('still serves the previous app version: record_scan(code, source) and claim_plates()', async () => {
    const url = await asAnon(db, (tx) => rpc(tx, 'record_scan', { p_code: 'a7x92', p_source: 'nfc' }));
    expect(url).toBe('https://search.google.com/local/writereview?placeid=ChIJEXAMPLEPLACEID0000');
    const owner = await createUser(db, 'owner@example.com');
    await asUser(db, owner, (tx) => rpc(tx, 'claim_plates'));
    // The old dashboard query: plates where owner_id = me.
    const mine = await asUser(db, owner, (tx) => tx.query('select code from public.plates where owner_id = $1 order by code', [owner.id]));
    expect(mine.rows.map((r) => r.code)).toEqual(['A7X92', 'KOPI2']);
  });

  it('still accepts a plate created the old way (no business_id) and gives it a location', async () => {
    await db.exec(`insert into public.plates (code, business_name, owner_email, destination_url, plan)
                   values ('oldwy', 'Old Way Cafe', 'old@example.com', 'https://g.page/r/old/review', 'basic')`);
    const { rows } = await db.query(`select p.code, b.name, c.owner_email from public.plates p
      join public.businesses b on b.id = p.business_id join public.companies c on c.id = b.company_id where p.code = 'OLDWY'`);
    expect(rows).toEqual([{ code: 'OLDWY', name: 'Old Way Cafe', owner_email: 'old@example.com' }]);
  });

  it('gives anonymous visitors no direct table access', async () => {
    for (const table of ['plates', 'scans', 'companies', 'businesses', 'subscriptions', 'payments', 'link_pages']) {
      const error = await rejected(asAnon(db, (tx) => tx.query(`select * from public.${table} limit 1`)));
      expect(error.message).toMatch(/permission denied/);
    }
  });
});
