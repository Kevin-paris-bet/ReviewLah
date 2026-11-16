import { describe, it, expect, beforeAll } from 'vitest';
import { createDb, createUser, makeAdmin, asUser, asAnon, asService, rpc, rejected } from '../helpers/db.js';

const review = (id, rating, comment, createTime, reply = null) => ({
  review_id: id, resource_name: `accounts/1/locations/2/reviews/${id}`, reviewer_name: `Reviewer ${id}`, rating, comment,
  create_time: createTime, update_time: createTime, reply_comment: reply, reply_update_time: reply ? createTime : null,
});
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

describe('Google Business Profile data', () => {
  let db; let admin; let owner; let stranger; let pro; let basic;

  beforeAll(async () => {
    db = await createDb();
    admin = await createUser(db, 'admin@reviewlah.my');
    await makeAdmin(db, admin);
    owner = await createUser(db, 'owner@kopi.my');
    stranger = await createUser(db, 'stranger@example.com');
    const make = (name, isPro) => asUser(db, admin, (tx) => rpc(tx, 'admin_create_bundle', {
      p_company_name: 'Kopi', p_owner_email: 'owner@kopi.my', p_contact_name: null, p_phone: null, p_business_name: name,
      p_address: null, p_review_url: 'https://g.page/r/kopi/review', p_plate_count: 1, p_plate_label: null, p_pro: isPro, p_pro_until: null, p_company_id: null,
    }));
    pro = await make('Kopi Bangsar', true);
    basic = await make('Kopi TTDI', false);
    await asUser(db, owner, (tx) => rpc(tx, 'claim_account'));
    await asService(db, (tx) => rpc(tx, 'google_save_connection', {
      p_company_id: pro.company_id, p_user_id: owner.id, p_account_label: 'Aisha Rahman', p_refresh_token_enc: 'v1.iv.tag.ciphertext', p_scope: 'https://www.googleapis.com/auth/business.manage',
    }));
    await asService(db, (tx) => rpc(tx, 'google_link_location', {
      p_business_id: pro.business_id, p_account_name: 'accounts/1', p_location_name: 'locations/2', p_title: 'Kopi Corner Bangsar', p_address: 'Jalan Telawi 3', p_place_id: 'ChIJ1',
    }));
  });

  it('never exposes tokens: the connection table is closed to owners, admins and visitors', async () => {
    for (const run of [(fn) => asUser(db, owner, fn), (fn) => asUser(db, admin, fn), (fn) => asAnon(db, fn)]) {
      const error = await rejected(run((tx) => tx.query('select refresh_token_enc from public.google_connections')));
      expect(error.message).toMatch(/permission denied/);
    }
    const status = await asUser(db, owner, (tx) => rpc(tx, 'google_status'));
    expect(status.connections).toEqual([expect.objectContaining({ status: 'active', account_label: 'Aisha Rahman' })]);
    expect(JSON.stringify(status)).not.toContain('ciphertext');
    expect(status.locations).toEqual([expect.objectContaining({ business_id: pro.business_id, title: 'Kopi Corner Bangsar' })]);
    expect((await asUser(db, stranger, (tx) => rpc(tx, 'google_status'))).connections).toEqual([]);
  });

  it('only the server can connect, link or import', async () => {
    const calls = [
      ['google_save_connection', { p_company_id: pro.company_id, p_user_id: owner.id, p_account_label: 'x', p_refresh_token_enc: 'x', p_scope: 'x' }],
      ['google_link_location', { p_business_id: pro.business_id, p_account_name: 'accounts/9', p_location_name: 'locations/9', p_title: 'x', p_address: 'x', p_place_id: 'x' }],
      ['google_upsert_reviews', { p_business_id: pro.business_id, p_reviews: [], p_complete: false, p_average: null, p_total: null }],
      ['google_set_reply', { p_review_id: '00000000-0000-4000-8000-000000000000', p_comment: 'x', p_time: null, p_actor: null }],
      ['google_sync_targets', { p_company_id: null }],
    ];
    for (const [name, args] of calls) {
      const error = await rejected(asUser(db, owner, (tx) => rpc(tx, name, args)));
      expect(error.message, name).toMatch(/permission denied/);
    }
  });

  it('imports reviews, reports only the new ones, and updates the listing figures', async () => {
    const first = await asService(db, (tx) => rpc(tx, 'google_upsert_reviews', {
      p_business_id: pro.business_id, p_complete: true, p_average: 4.3, p_total: 3,
      p_reviews: [review('r1', 5, 'Great kopi', daysAgo(40)), review('r2', 2, 'Slow service', daysAgo(5)), review('r3', 4, null, daysAgo(2), 'Thank you!')],
    }));
    expect(first.map((r) => r.review_id).sort()).toEqual(['r1', 'r2', 'r3']);
    const again = await asService(db, (tx) => rpc(tx, 'google_upsert_reviews', {
      p_business_id: pro.business_id, p_complete: false, p_average: 4.4, p_total: 4,
      p_reviews: [review('r2', 3, 'Slow service, but friendly', daysAgo(5)), review('r4', 5, 'Best in Bangsar', daysAgo(0))],
    }));
    expect(again.map((r) => r.review_id)).toEqual(['r4']);
    const rows = (await db.query('select review_id, rating, comment from public.google_reviews order by review_id')).rows;
    expect(rows).toHaveLength(4);
    expect(rows[1]).toEqual({ review_id: 'r2', rating: 3, comment: 'Slow service, but friendly' });
    const link = (await db.query('select average_rating, total_review_count, last_synced_at from public.google_locations')).rows[0];
    expect(Number(link.average_rating)).toBe(4.4);
    expect(link.total_review_count).toBe(4);
    expect(link.last_synced_at).toBeTruthy();
  });

  it('removes reviews that Google no longer returns on a complete import', async () => {
    await asService(db, (tx) => rpc(tx, 'google_upsert_reviews', {
      p_business_id: pro.business_id, p_complete: true, p_average: null, p_total: null,
      p_reviews: [review('r2', 3, 'Slow service, but friendly', daysAgo(5)), review('r3', 4, null, daysAgo(2), 'Thank you!'), review('r4', 5, 'Best in Bangsar', daysAgo(0))],
    }));
    expect((await db.query('select count(*)::int as n from public.google_reviews')).rows[0].n).toBe(3);
  });

  it('shows the inbox to the owner of a Pro location only', async () => {
    const inbox = await asUser(db, owner, (tx) => rpc(tx, 'review_inbox', { p_business_id: pro.business_id, p_filter: 'all', p_limit: 20, p_offset: 0 }));
    expect(inbox).toMatchObject({ total: 3, unreplied: 2, low: 1, matching: 3, by_rating: [0, 0, 1, 1, 1] });
    expect(Number(inbox.average)).toBe(4);
    expect(inbox.rows.map((r) => r.reviewer_name)).toEqual(['Reviewer r4', 'Reviewer r3', 'Reviewer r2']);
    const unreplied = await asUser(db, owner, (tx) => rpc(tx, 'review_inbox', { p_business_id: pro.business_id, p_filter: 'unreplied', p_limit: 20, p_offset: 0 }));
    expect(unreplied.rows).toHaveLength(2);
    expect((await rejected(asUser(db, stranger, (tx) => rpc(tx, 'review_inbox', { p_business_id: pro.business_id })))).message).toMatch(/not_allowed/);
    expect((await rejected(asUser(db, owner, (tx) => rpc(tx, 'review_inbox', { p_business_id: basic.business_id })))).message).toMatch(/pro_required/);
    expect((await asUser(db, stranger, (tx) => tx.query('select * from public.google_reviews'))).rows).toEqual([]);
    expect((await asUser(db, owner, (tx) => tx.query('select * from public.google_reviews'))).rows).toHaveLength(3);
  });

  it('keeps a draft as a draft until the server records a published reply', async () => {
    const target = (await db.query("select id from public.google_reviews where review_id = 'r2'")).rows[0].id;
    await asUser(db, owner, (tx) => rpc(tx, 'save_reply_draft', { p_review_id: target, p_body: 'Maaf atas kelewatan.', p_language: 'ms', p_source: 'ai', p_model: 'claude-haiku-5-5' }));
    let row = (await db.query('select reply_comment from public.google_reviews where id = $1', [target])).rows[0];
    expect(row.reply_comment).toBeNull(); // a draft changes nothing on the review
    const inbox = await asUser(db, owner, (tx) => rpc(tx, 'review_inbox', { p_business_id: pro.business_id, p_filter: 'unreplied' }));
    expect(inbox.rows.find((r) => r.id === target).draft).toMatchObject({ body: 'Maaf atas kelewatan.', language: 'ms', source: 'ai' });

    expect((await rejected(asUser(db, stranger, (tx) => rpc(tx, 'save_reply_draft', { p_review_id: target, p_body: 'x' })))).message).toMatch(/not_allowed/);
    expect((await rejected(asUser(db, owner, (tx) => rpc(tx, 'save_reply_draft', { p_review_id: target, p_body: '   ' })))).message).toMatch(/reply_empty/);
    expect((await rejected(asUser(db, owner, (tx) => rpc(tx, 'save_reply_draft', { p_review_id: target, p_body: 'x'.repeat(4001) })))).message).toMatch(/reply_long/);

    await asService(db, (tx) => rpc(tx, 'google_set_reply', { p_review_id: target, p_comment: 'Maaf atas kelewatan. Kami akan perbaiki.', p_time: new Date().toISOString(), p_actor: owner.id }));
    row = (await db.query('select reply_comment from public.google_reviews where id = $1', [target])).rows[0];
    expect(row.reply_comment).toBe('Maaf atas kelewatan. Kami akan perbaiki.');
    expect((await db.query('select count(*)::int as n from public.review_reply_drafts')).rows[0].n).toBe(0);
    expect((await db.query("select count(*)::int as n from public.audit_log where action = 'review.reply_published'")).rows[0].n).toBe(1);
  });

  it('gives the monthly email its review figures, in Malaysia time', async () => {
    const month = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 8) + '01';
    const data = await asService(db, (tx) => rpc(tx, 'monthly_review_data', { p_month: month }));
    expect(Object.keys(data)).toEqual([pro.business_id]);
    expect(data[pro.business_id]).toMatchObject({ total_reviews: 3, unreplied: 1 });
    expect((await rejected(asUser(db, owner, (tx) => rpc(tx, 'monthly_review_data', { p_month: month })))).message).toMatch(/permission denied/);
  });

  it('lists what to refresh: active connections and their Pro locations only', async () => {
    const targets = await asService(db, (tx) => rpc(tx, 'google_sync_targets', { p_company_id: null }));
    expect(targets).toHaveLength(1);
    expect(targets[0].locations.map((l) => l.business_id)).toEqual([pro.business_id]);
    expect(targets[0]).toMatchObject({ owner_email: 'owner@kopi.my', email_review_alerts: true });
  });

  it('keeps Google data 30 days after Pro ends, then deletes it', async () => {
    await asUser(db, admin, (tx) => rpc(tx, 'admin_set_pro', { p_business_id: pro.business_id, p_enabled: false, p_until: null }));
    expect((await asService(db, (tx) => rpc(tx, 'google_maintenance'))).unlinked_locations).toBe(0);
    expect((await asUser(db, owner, (tx) => tx.query('select * from public.google_reviews'))).rows).toEqual([]); // no longer readable without Pro
    await db.query("update public.subscriptions set ended_at = now() - interval '31 days', updated_at = now() - interval '31 days', current_period_end = null where business_id = $1", [pro.business_id]);
    await db.query("update public.google_locations set linked_at = now() - interval '60 days'");
    await db.query('alter table public.subscriptions disable trigger subscriptions_touch');
    await db.query("update public.subscriptions set updated_at = now() - interval '31 days' where business_id = $1", [pro.business_id]);
    await db.query('alter table public.subscriptions enable trigger subscriptions_touch');
    expect((await asService(db, (tx) => rpc(tx, 'google_maintenance'))).unlinked_locations).toBe(1);
    expect((await db.query('select count(*)::int as n from public.google_reviews')).rows[0].n).toBe(0);
    expect((await db.query('select count(*)::int as n from public.google_locations')).rows[0].n).toBe(0);
  });

  it('disconnect deletes the tokens, the links, the reviews and the drafts, for the owner only', async () => {
    await asUser(db, admin, (tx) => rpc(tx, 'admin_set_pro', { p_business_id: pro.business_id, p_enabled: true, p_until: null }));
    await asService(db, (tx) => rpc(tx, 'google_link_location', {
      p_business_id: pro.business_id, p_account_name: 'accounts/1', p_location_name: 'locations/2', p_title: 'Kopi Corner Bangsar', p_address: null, p_place_id: null,
    }));
    await asService(db, (tx) => rpc(tx, 'google_upsert_reviews', { p_business_id: pro.business_id, p_reviews: [review('r9', 5, 'Hello', daysAgo(1))], p_complete: false, p_average: null, p_total: null }));
    const id = (await db.query("select id from public.google_reviews where review_id = 'r9'")).rows[0].id;
    await asUser(db, owner, (tx) => rpc(tx, 'save_reply_draft', { p_review_id: id, p_body: 'Thanks!' }));

    expect((await rejected(asUser(db, stranger, (tx) => rpc(tx, 'google_delete_data', { p_company_id: pro.company_id })))).message).toMatch(/not_allowed/);
    const result = await asUser(db, owner, (tx) => rpc(tx, 'google_delete_data', { p_company_id: pro.company_id }));
    expect(result).toEqual({ reviews: 1, locations: 1, connections: 1 });
    for (const table of ['google_connections', 'google_locations', 'google_reviews', 'review_reply_drafts']) {
      expect((await db.query(`select count(*)::int as n from public.${table}`)).rows[0].n, table).toBe(0);
    }
    // Scans, plates and the plan are untouched.
    expect((await db.query('select count(*)::int as n from public.plates')).rows[0].n).toBe(2);
    expect((await db.query('select public.business_is_pro($1) as pro', [pro.business_id])).rows[0].pro).toBe(true);
  });
});
