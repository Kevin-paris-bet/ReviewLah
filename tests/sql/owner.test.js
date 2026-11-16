import { describe, it, expect, beforeAll } from 'vitest';
import { createDb, createUser, makeAdmin, asUser, asAnon, rpc, rejected } from '../helpers/db.js';
import { VALID_REVIEW_LINKS, INVALID_REVIEW_LINKS } from '../helpers/review-links.js';
import { normalizeLinks } from '../../lib/validation.js';

const bundle = (overrides = {}) => ({
  p_company_name: null, p_owner_email: null, p_contact_name: null, p_phone: null,
  p_business_name: 'Kopi Corner', p_address: null, p_review_url: 'https://g.page/r/kopi/review',
  p_plate_count: 1, p_plate_label: null, p_pro: false, p_pro_until: null, p_company_id: null, ...overrides,
});

describe('what a business owner can see and change', () => {
  let db;
  let admin;
  let aisha;
  let ben;
  let kopi;
  let kopi2;
  let salon;

  beforeAll(async () => {
    db = await createDb();
    admin = await createUser(db, 'admin@reviewlah.my');
    await makeAdmin(db, admin);
    aisha = await createUser(db, 'aisha@kopi.my');
    kopi = await asUser(db, admin, (tx) => rpc(tx, 'admin_create_bundle', bundle({ p_owner_email: 'Aisha@Kopi.my', p_plate_count: 2, p_pro: true })));
    kopi2 = await asUser(db, admin, (tx) => rpc(tx, 'admin_create_bundle', bundle({ p_owner_email: 'aisha@kopi.my', p_business_name: 'Kopi Corner TTDI', p_review_url: 'https://g.page/r/kopi-ttdi/review' })));
    // Ben has no login yet when his plate is created: the account is attached at his first login.
    salon = await asUser(db, admin, (tx) => rpc(tx, 'admin_create_bundle', bundle({ p_owner_email: 'ben@salon.my', p_business_name: 'Salon Seri', p_review_url: 'https://g.page/r/salon/review' })));
    ben = await createUser(db, 'ben@salon.my');
  });

  it('attaches the account at first login and returns the whole dashboard in one call', async () => {
    expect(kopi2.existing_company).toBe(true);
    expect(kopi2.company_id).toBe(kopi.company_id);
    const data = await asUser(db, ben, (tx) => rpc(tx, 'dashboard_bootstrap'));
    expect(data.companies).toHaveLength(1);
    expect(data.businesses).toHaveLength(1);
    expect(data.businesses[0]).toMatchObject({ name: 'Salon Seri', is_pro: false, total_scans: 0, recent: null });
    expect(data.businesses[0].plates).toHaveLength(1);

    const mine = await asUser(db, aisha, (tx) => rpc(tx, 'dashboard_bootstrap'));
    expect(mine.businesses.map((b) => b.name)).toEqual(['Kopi Corner', 'Kopi Corner TTDI']);
    expect(mine.businesses[0].is_pro).toBe(true);
    expect(mine.businesses[0].recent).toMatchObject({ d7: 0, d30: 0 });
    expect(mine.businesses[0].plates).toHaveLength(2);
    expect(mine.businesses[1].is_pro).toBe(false); // Pro is per location
    expect(mine.is_admin).toBe(false);
  });

  it('shows each owner only their own rows (row level security)', async () => {
    for (const table of ['companies', 'businesses', 'plates', 'subscriptions']) {
      const { rows } = await asUser(db, ben, (tx) => tx.query(`select count(*)::int as n from public.${table}`));
      expect(rows[0].n, table).toBe(table === 'subscriptions' ? 0 : 1);
    }
    const { rows } = await asUser(db, aisha, (tx) => tx.query('select count(*)::int as n from public.plates'));
    expect(rows[0].n).toBe(3);
    const stranger = await createUser(db, 'nobody@example.com');
    const empty = await asUser(db, stranger, (tx) => rpc(tx, 'dashboard_bootstrap'));
    expect(empty.businesses).toEqual([]);
    expect(empty.companies).toEqual([]);
  });

  it('does not let an owner write to tables directly, only through the checked functions', async () => {
    const attempts = [
      "update public.plates set destination_url = 'https://evil.example.com'",
      "update public.businesses set review_url = 'https://evil.example.com'",
      "update public.companies set owner_email = 'thief@example.com'",
      "insert into public.subscriptions (business_id, status, provider) select id, 'active', 'manual' from public.businesses",
      "update public.subscriptions set status = 'active'",
      'delete from public.plates',
      "insert into public.admins (user_id) select id from auth.users where email = 'ben@salon.my'",
    ];
    for (const sql of attempts) {
      const result = await asUser(db, ben, (tx) => tx.query(sql)).then((r) => r, (e) => e);
      const blocked = result instanceof Error ? /permission denied|row-level security/.test(result.message) : result.affectedRows === 0;
      expect(blocked, sql).toBe(true);
    }
    expect((await db.query("select count(*)::int as n from public.plates where destination_url like '%evil%'")).rows[0].n).toBe(0);
    expect((await db.query('select count(*)::int as n from public.admins')).rows[0].n).toBe(1);
    expect((await asUser(db, ben, (tx) => rpc(tx, 'business_is_pro', { p_business_id: salon.business_id })))).toBe(false);
  });

  it('lets the owner change the Google review link of a location, for all its plates at once', async () => {
    const next = 'https://search.google.com/local/writereview?placeid=ChIJNEW';
    await asUser(db, aisha, (tx) => rpc(tx, 'update_business_review_url', { p_business_id: kopi.business_id, p_url: `  ${next} ` }));
    const { rows } = await db.query('select destination_url from public.plates where business_id = $1', [kopi.business_id]);
    expect(rows.map((r) => r.destination_url)).toEqual([next, next]);
    const code = kopi.plates[0].code;
    expect(await asAnon(db, (tx) => rpc(tx, 'record_scan', { p_code: code, p_source: 'qr', p_device: null }))).toBe(next);
    const log = await db.query("select detail from public.audit_log where action = 'review_url.updated'");
    expect(log.rows[0].detail).toMatchObject({ from: 'https://g.page/r/kopi/review', to: next });
  });

  it('refuses a link that is not a Google page, and refuses another owner', async () => {
    const bad = await rejected(asUser(db, aisha, (tx) => rpc(tx, 'update_business_review_url', { p_business_id: kopi.business_id, p_url: 'https://evil.example.com/review' })));
    expect(bad.message).toMatch(/invalid_review_url/);
    const other = await rejected(asUser(db, ben, (tx) => rpc(tx, 'update_business_review_url', { p_business_id: kopi.business_id, p_url: 'https://g.page/r/x/review' })));
    expect(other.message).toMatch(/not_allowed/);
    const label = await rejected(asUser(db, ben, (tx) => rpc(tx, 'update_plate_label', { p_plate_id: kopi.plates[0].id, p_label: 'Mine now' })));
    expect(label.message).toMatch(/not_allowed/);
  });

  it('applies exactly the same review-link rule in SQL as in JavaScript', async () => {
    for (const link of VALID_REVIEW_LINKS) {
      const { rows } = await db.query('select public.is_valid_review_url($1) as ok', [link]);
      expect(rows[0].ok, link).toBe(true);
    }
    for (const link of INVALID_REVIEW_LINKS) {
      const { rows } = await db.query('select public.is_valid_review_url($1) as ok', [link]);
      expect(rows[0].ok, link).toBe(false);
    }
  });

  it('lets the owner label plates, rename the location and update the account', async () => {
    await asUser(db, aisha, async (tx) => {
      await rpc(tx, 'update_plate_label', { p_plate_id: kopi.plates[0].id, p_label: '  Counter  ' });
      await rpc(tx, 'update_business_details', { p_business_id: kopi.business_id, p_name: 'Kopi Corner Bangsar', p_address: '1 Jalan Telawi' });
      await rpc(tx, 'update_my_account', {
        p_company_id: kopi.company_id, p_name: 'Kopi Corner Sdn Bhd', p_contact_name: 'Aisha', p_phone: '+60 12-345 6789',
        p_whatsapp: '+60123456789', p_email_monthly_summary: false, p_email_review_alerts: true,
      });
    });
    const data = await asUser(db, aisha, (tx) => rpc(tx, 'dashboard_bootstrap'));
    expect(data.businesses[0]).toMatchObject({ name: 'Kopi Corner Bangsar', address: '1 Jalan Telawi' });
    expect(data.businesses[0].plates[0].label).toBe('Counter');
    expect(data.companies[0]).toMatchObject({ name: 'Kopi Corner Sdn Bhd', contact_name: 'Aisha', email_monthly_summary: false });
    const phone = await rejected(asUser(db, aisha, (tx) => rpc(tx, 'update_my_account', {
      p_company_id: kopi.company_id, p_name: 'Kopi', p_contact_name: null, p_phone: 'call me maybe', p_whatsapp: null,
      p_email_monthly_summary: true, p_email_review_alerts: true,
    })));
    expect(phone.message).toMatch(/invalid_phone/);
    const foreign = await rejected(asUser(db, ben, (tx) => rpc(tx, 'update_my_account', {
      p_company_id: kopi.company_id, p_name: 'Hijack', p_contact_name: null, p_phone: null, p_whatsapp: null,
      p_email_monthly_summary: true, p_email_review_alerts: true,
    })));
    expect(foreign.message).toMatch(/not_allowed/);
  });

  it('keeps the links page for Pro locations, and always shows the same Google review link', async () => {
    const page = normalizeLinks([
      { kind: 'menu', label: 'Our menu', url: 'kopi.my/menu' },
      { kind: 'whatsapp', label: '', url: '012-345 6789' },
      { kind: 'instagram', label: '', url: '@kopi.corner' },
      { kind: 'phone', label: '', url: '03-1234 5678' },
      { kind: 'email', label: '', url: 'hello@kopi.my' },
    ]);
    expect(page.ok).toBe(true);
    await asUser(db, aisha, (tx) => rpc(tx, 'save_link_page', { p_business_id: kopi.business_id, p_headline: 'Thanks for visiting', p_links: page.links, p_published: true }));
    const slug = (await db.query('select slug from public.businesses where id = $1', [kopi.business_id])).rows[0].slug;
    const pub = await asAnon(db, (tx) => rpc(tx, 'get_link_page', { p_slug: slug }));
    expect(pub.links).toHaveLength(5);
    expect(pub.headline).toBe('Thanks for visiting');
    expect(pub.review_url).toMatch(/^https:\/\/search\.google\.com\/local\/writereview/);

    const evil = await rejected(asUser(db, aisha, (tx) => rpc(tx, 'save_link_page', {
      p_business_id: kopi.business_id, p_headline: null, p_links: [{ kind: 'other', label: 'Click', url: 'javascript:alert(1)' }], p_published: true })));
    expect(evil.message).toMatch(/invalid_links/);
    const basic = await rejected(asUser(db, ben, (tx) => rpc(tx, 'save_link_page', { p_business_id: salon.business_id, p_headline: null, p_links: [], p_published: true })));
    expect(basic.message).toMatch(/pro_required/);

    // When Pro ends, the page still opens and still offers the Google review link; extra links are hidden.
    await asUser(db, admin, (tx) => rpc(tx, 'admin_set_pro', { p_business_id: kopi.business_id, p_enabled: false, p_until: null }));
    const after = await asAnon(db, (tx) => rpc(tx, 'get_link_page', { p_slug: slug }));
    expect(after.links).toEqual([]);
    expect(after.review_url).toBe(pub.review_url);
    expect(await asAnon(db, (tx) => rpc(tx, 'get_link_page', { p_slug: 'does-not-exist' }))).toBeNull();
    await asUser(db, admin, (tx) => rpc(tx, 'admin_set_pro', { p_business_id: kopi.business_id, p_enabled: true, p_until: null }));
  });

  it('records support requests, with a daily limit', async () => {
    const id = await asUser(db, ben, (tx) => rpc(tx, 'create_support_request', { p_topic: 'Plate support', p_message: 'My plate does not open the page.' }));
    expect(id).toBeTruthy();
    const { rows } = await asUser(db, admin, (tx) => tx.query('select email, company_id, status from public.support_requests'));
    expect(rows).toEqual([{ email: 'ben@salon.my', company_id: salon.company_id, status: 'open' }]);
    const short = await rejected(asUser(db, ben, (tx) => rpc(tx, 'create_support_request', { p_topic: 'x', p_message: 'hi' })));
    expect(short.message).toMatch(/invalid_message/);
    for (let i = 0; i < 4; i += 1) {
      await asUser(db, ben, (tx) => rpc(tx, 'create_support_request', { p_topic: 'More', p_message: `Message number ${i}` }));
    }
    const limit = await rejected(asUser(db, ben, (tx) => rpc(tx, 'create_support_request', { p_topic: 'More', p_message: 'One too many' })));
    expect(limit.message).toMatch(/too_many_requests/);
    const others = await asUser(db, aisha, (tx) => tx.query('select count(*)::int as n from public.support_requests'));
    expect(others.rows[0].n).toBe(0);
  });

  it('follows a confirmed login-email change, without taking over someone else\'s account', async () => {
    await db.query("update auth.users set email = 'aisha.new@kopi.my' where id = $1", [aisha.id]);
    const renamed = { id: aisha.id, email: 'aisha.new@kopi.my' };
    const data = await asUser(db, renamed, (tx) => rpc(tx, 'dashboard_bootstrap'));
    expect(data.companies[0].owner_email).toBe('aisha.new@kopi.my');
    expect(data.businesses).toHaveLength(2);
    // Someone who later signs up with the old address gets nothing.
    const squatter = await createUser(db, 'aisha@kopi.my');
    const none = await asUser(db, squatter, (tx) => rpc(tx, 'dashboard_bootstrap'));
    expect(none.businesses).toEqual([]);
  });
});
