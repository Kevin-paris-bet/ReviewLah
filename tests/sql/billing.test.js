import { describe, it, expect, beforeAll } from 'vitest';
import { createDb, createUser, makeAdmin, asUser, asService, rpc, rejected } from '../helpers/db.js';

const PROVIDER = 'airwallex';

async function setup() {
  const db = await createDb();
  const admin = await createUser(db, 'admin@reviewlah.my');
  await makeAdmin(db, admin);
  const owner = await createUser(db, 'owner@kopi.my');
  const make = (name) => asUser(db, admin, (tx) => rpc(tx, 'admin_create_bundle', {
    p_company_name: 'Kopi', p_owner_email: 'owner@kopi.my', p_contact_name: null, p_phone: null,
    p_business_name: name, p_address: null, p_review_url: 'https://g.page/r/kopi/review',
    p_plate_count: 1, p_plate_label: null, p_pro: false, p_pro_until: null, p_company_id: null,
  }));
  const a = await make('Kopi Bangsar');
  const b = await make('Kopi TTDI');
  await asUser(db, owner, (tx) => rpc(tx, 'claim_account'));
  const isPro = async (id) => (await db.query('select public.business_is_pro($1) as pro', [id])).rows[0].pro;
  const apply = (eventId, type, normalized) => asService(db, (tx) => rpc(tx, 'billing_apply_event', {
    p_provider: PROVIDER, p_event_id: eventId, p_event_type: type, p_payload: { id: eventId }, p_normalized: normalized,
  }));
  return { db, admin, owner, a, b, isPro, apply };
}

const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString();

describe('subscriptions driven by payment provider events', () => {
  let ctx;
  let checkout;
  beforeAll(async () => { ctx = await setup(); });

  it('opens a checkout for one location without granting anything', async () => {
    checkout = await asUser(ctx.db, ctx.owner, (tx) => rpc(tx, 'billing_begin_checkout', { p_business_id: ctx.a.business_id, p_interval: 'year', p_provider: PROVIDER }));
    expect(checkout).toMatchObject({ business_id: ctx.a.business_id, email: 'owner@kopi.my', provider_customer_id: null });
    await asUser(ctx.db, ctx.owner, (tx) => rpc(tx, 'billing_attach_checkout', { p_subscription_id: checkout.subscription_id, p_checkout_id: 'chk_1', p_customer_id: 'cus_1' }));
    expect(await ctx.isPro(ctx.a.business_id)).toBe(false);
    const bad = await rejected(asUser(ctx.db, ctx.owner, (tx) => rpc(tx, 'billing_begin_checkout', { p_business_id: ctx.a.business_id, p_interval: 'week', p_provider: PROVIDER })));
    expect(bad.message).toMatch(/invalid_interval/);
    const stranger = await createUser(ctx.db, 'stranger@example.com');
    const denied = await rejected(asUser(ctx.db, stranger, (tx) => rpc(tx, 'billing_begin_checkout', { p_business_id: ctx.a.business_id, p_interval: 'month', p_provider: PROVIDER })));
    expect(denied.message).toMatch(/not_allowed/);
  });

  it('cannot be activated from the browser: only the server applies provider events', async () => {
    const denied = await rejected(asUser(ctx.db, ctx.owner, (tx) => rpc(tx, 'billing_apply_event', {
      p_provider: PROVIDER, p_event_id: 'forged', p_event_type: 'subscription.active', p_payload: {},
      p_normalized: { kind: 'subscription', business_id: ctx.a.business_id, status: 'active' },
    })));
    expect(denied.message).toMatch(/permission denied/);
    expect(await ctx.isPro(ctx.a.business_id)).toBe(false);
  });

  it('activates Pro for that location only when the payment is confirmed', async () => {
    const result = await ctx.apply('evt_1', 'subscription.created', {
      kind: 'subscription', provider_checkout_id: 'chk_1', provider_subscription_id: 'sub_1', provider_customer_id: 'cus_1',
      status: 'active', billing_interval: 'year', current_period_start: inDays(0), current_period_end: inDays(365),
      occurred_at: inDays(0),
    });
    expect(result).toMatchObject({ outcome: 'applied', business_id: ctx.a.business_id, status: 'active', previous_status: 'incomplete' });
    expect(result.subscription_id).toBe(checkout.subscription_id);
    expect(await ctx.isPro(ctx.a.business_id)).toBe(true);
    expect(await ctx.isPro(ctx.b.business_id)).toBe(false);
    const again = await rejected(asUser(ctx.db, ctx.owner, (tx) => rpc(tx, 'billing_begin_checkout', { p_business_id: ctx.a.business_id, p_interval: 'month', p_provider: PROVIDER })));
    expect(again.message).toMatch(/already_subscribed/);
  });

  it('ignores a webhook delivered twice', async () => {
    const result = await ctx.apply('evt_1', 'subscription.created', { kind: 'subscription', provider_subscription_id: 'sub_1', status: 'canceled' });
    expect(result).toEqual({ outcome: 'duplicate' });
    expect(await ctx.isPro(ctx.a.business_id)).toBe(true);
  });

  it('records payments once and attaches them to the location', async () => {
    const payment = { kind: 'payment', provider_payment_id: 'inv_1', provider_subscription_id: 'sub_1', status: 'succeeded', amount_cents: 29000, currency: 'myr', paid_at: inDays(0) };
    await ctx.apply('evt_2', 'invoice.paid', payment);
    await ctx.apply('evt_2b', 'invoice.updated', { ...payment, invoice_url: 'https://pay.example.com/inv_1' });
    const { rows } = await asUser(ctx.db, ctx.owner, (tx) => tx.query('select business_id, status, amount_cents, currency, invoice_url from public.payments'));
    expect(rows).toEqual([{ business_id: ctx.a.business_id, status: 'succeeded', amount_cents: 29000, currency: 'MYR', invoice_url: 'https://pay.example.com/inv_1' }]);
    const stranger = await createUser(ctx.db, 'peek@example.com');
    const hidden = await asUser(ctx.db, stranger, (tx) => tx.query('select count(*)::int as n from public.payments'));
    expect(hidden.rows[0].n).toBe(0);
  });

  it('keeps Pro during payment retries, then removes it; the plate keeps working throughout', async () => {
    await ctx.apply('evt_3', 'subscription.past_due', { kind: 'subscription', provider_subscription_id: 'sub_1', status: 'past_due', occurred_at: inDays(0.001) });
    expect(await ctx.isPro(ctx.a.business_id)).toBe(true);
    // The paid period ended 9 days ago and the payment still fails: grace is over.
    await ctx.db.query("update public.subscriptions set current_period_end = now() - interval '9 days' where provider_subscription_id = 'sub_1'");
    expect(await ctx.isPro(ctx.a.business_id)).toBe(false);
    const code = ctx.a.plates[0].code;
    const url = (await ctx.db.query('select public.record_scan($1, $2) as url', [code, 'nfc'])).rows[0].url;
    expect(url).toBe('https://g.page/r/kopi/review');
    const data = await asUser(ctx.db, ctx.owner, (tx) => rpc(tx, 'dashboard_bootstrap'));
    expect(data.businesses[0]).toMatchObject({ is_pro: false, total_scans: 1 });
    expect(data.businesses[0].subscription.status).toBe('past_due');
  });

  it('renews: a successful payment puts the subscription back to active with a new period', async () => {
    await ctx.apply('evt_4', 'subscription.updated', {
      kind: 'subscription', provider_subscription_id: 'sub_1', status: 'active',
      current_period_start: inDays(0), current_period_end: inDays(365), occurred_at: inDays(0.002),
    });
    expect(await ctx.isPro(ctx.a.business_id)).toBe(true);
  });

  it('does not let an older event overwrite a newer state', async () => {
    const result = await ctx.apply('evt_old', 'subscription.updated', { kind: 'subscription', provider_subscription_id: 'sub_1', status: 'canceled', occurred_at: inDays(-1) });
    expect(result.outcome).toBe('ignored');
    expect(await ctx.isPro(ctx.a.business_id)).toBe(true);
  });

  it('lets the owner schedule a cancellation: Pro stays until the end of the paid period', async () => {
    const sub = (await ctx.db.query("select id from public.subscriptions where provider_subscription_id = 'sub_1'")).rows[0].id;
    await asUser(ctx.db, ctx.owner, (tx) => rpc(tx, 'billing_set_cancel', { p_subscription_id: sub, p_cancel: true }));
    expect(await ctx.isPro(ctx.a.business_id)).toBe(true);
    let data = await asUser(ctx.db, ctx.owner, (tx) => rpc(tx, 'dashboard_bootstrap'));
    expect(data.businesses[0].subscription.cancel_at_period_end).toBe(true);
    await asUser(ctx.db, ctx.owner, (tx) => rpc(tx, 'billing_set_cancel', { p_subscription_id: sub, p_cancel: false }));
    data = await asUser(ctx.db, ctx.owner, (tx) => rpc(tx, 'dashboard_bootstrap'));
    expect(data.businesses[0].subscription.cancel_at_period_end).toBe(false);
    const stranger = await createUser(ctx.db, 'cancel@example.com');
    const denied = await rejected(asUser(ctx.db, stranger, (tx) => rpc(tx, 'billing_set_cancel', { p_subscription_id: sub, p_cancel: true })));
    expect(denied.message).toMatch(/not_allowed/);
  });

  it('ends Pro when the provider says the subscription is cancelled; Basic remains', async () => {
    await ctx.apply('evt_5', 'subscription.cancelled', { kind: 'subscription', provider_subscription_id: 'sub_1', status: 'canceled', occurred_at: inDays(0.003) });
    expect(await ctx.isPro(ctx.a.business_id)).toBe(false);
    const data = await asUser(ctx.db, ctx.owner, (tx) => rpc(tx, 'dashboard_bootstrap'));
    expect(data.businesses[0].subscription.status).toBe('canceled');
    expect(data.businesses[0].plates).toHaveLength(1);
    expect(data.businesses[0].plates[0].active).toBe(true);
    // The location can subscribe again later.
    const next = await asUser(ctx.db, ctx.owner, (tx) => rpc(tx, 'billing_begin_checkout', { p_business_id: ctx.a.business_id, p_interval: 'month', p_provider: PROVIDER }));
    expect(next.provider_customer_id).toBe('cus_1'); // the provider customer is reused
  });

  it('parks events it cannot match instead of guessing', async () => {
    expect((await ctx.apply('evt_6', 'subscription.created', { kind: 'subscription', provider_subscription_id: 'sub_unknown', status: 'active' })).outcome).toBe('unmatched');
    expect((await ctx.apply('evt_7', 'something.else', { kind: 'ignore' })).outcome).toBe('ignored');
    expect((await ctx.apply('evt_8', 'subscription.updated', { kind: 'subscription', provider_subscription_id: 'sub_1', status: 'weird' })).outcome).toBe('ignored');
    const { rows } = await ctx.db.query("select event_id, outcome from public.payment_events where event_id in ('evt_6', 'evt_7', 'evt_8') order by 1");
    expect(rows).toEqual([{ event_id: 'evt_6', outcome: 'unmatched' }, { event_id: 'evt_7', outcome: 'ignored' }, { event_id: 'evt_8', outcome: 'ignored' }]);
    const peek = await rejected(asUser(ctx.db, ctx.owner, (tx) => tx.query('select * from public.payment_events')));
    expect(peek.message).toMatch(/permission denied/);
  });
});

describe('manual Pro (admin) and maintenance', () => {
  let ctx;
  beforeAll(async () => { ctx = await setup(); });

  it('lets only an admin switch Pro on and off by hand', async () => {
    const denied = await rejected(asUser(ctx.db, ctx.owner, (tx) => rpc(tx, 'admin_set_pro', { p_business_id: ctx.a.business_id, p_enabled: true, p_until: null })));
    expect(denied.message).toMatch(/not_allowed/);
    await asUser(ctx.db, ctx.admin, (tx) => rpc(tx, 'admin_set_pro', { p_business_id: ctx.a.business_id, p_enabled: true, p_until: null }));
    await asUser(ctx.db, ctx.admin, (tx) => rpc(tx, 'admin_set_pro', { p_business_id: ctx.a.business_id, p_enabled: true, p_until: null }));
    expect(await ctx.isPro(ctx.a.business_id)).toBe(true);
    expect((await ctx.db.query('select count(*)::int as n from public.subscriptions where business_id = $1', [ctx.a.business_id])).rows[0].n).toBe(1);
    const sub = (await ctx.db.query('select id from public.subscriptions where business_id = $1', [ctx.a.business_id])).rows[0].id;
    const owner = await rejected(asUser(ctx.db, ctx.owner, (tx) => rpc(tx, 'billing_set_cancel', { p_subscription_id: sub, p_cancel: true })));
    expect(owner.message).toMatch(/managed_by_support/);
    await asUser(ctx.db, ctx.admin, (tx) => rpc(tx, 'admin_set_pro', { p_business_id: ctx.a.business_id, p_enabled: false, p_until: null }));
    expect(await ctx.isPro(ctx.a.business_id)).toBe(false);
  });

  it('ends a manual Pro on its end date (Malaysia time) and cleans up abandoned checkouts', async () => {
    await asUser(ctx.db, ctx.admin, (tx) => rpc(tx, 'admin_set_pro', { p_business_id: ctx.b.business_id, p_enabled: true, p_until: '2020-01-31' }));
    expect(await ctx.isPro(ctx.b.business_id)).toBe(false); // end date in the past: no grace for manual Pro
    const end = (await ctx.db.query('select current_period_end from public.subscriptions where business_id = $1', [ctx.b.business_id])).rows[0].current_period_end;
    expect(end.toISOString()).toBe('2020-01-31T16:00:00.000Z'); // midnight at the end of 31 Jan in Kuala Lumpur
    await asUser(ctx.db, ctx.owner, (tx) => rpc(tx, 'billing_begin_checkout', { p_business_id: ctx.a.business_id, p_interval: 'month', p_provider: PROVIDER }));
    await ctx.db.query("update public.subscriptions set created_at = now() - interval '3 days' where status = 'incomplete'");
    const result = await asService(ctx.db, (tx) => rpc(tx, 'maintenance_daily'));
    expect(result).toMatchObject({ expired_subscriptions: 1, stale_checkouts: 1 });
    expect((await ctx.db.query('select status from public.subscriptions where business_id = $1', [ctx.b.business_id])).rows[0].status).toBe('canceled');
  });

  it('replaces a manual Pro by the paid subscription when the customer pays', async () => {
    await asUser(ctx.db, ctx.admin, (tx) => rpc(tx, 'admin_set_pro', { p_business_id: ctx.a.business_id, p_enabled: true, p_until: null }));
    const result = await ctx.apply('evt_m1', 'subscription.created', {
      kind: 'subscription', business_id: ctx.a.business_id, provider_subscription_id: 'sub_m1', status: 'active',
      billing_interval: 'month', current_period_end: inDays(30),
    });
    expect(result.outcome).toBe('applied');
    const { rows } = await ctx.db.query("select provider, status from public.subscriptions where business_id = $1 and status <> 'incomplete' order by provider", [ctx.a.business_id]);
    expect(rows).toEqual([{ provider: 'airwallex', status: 'active' }, { provider: 'manual', status: 'canceled' }, { provider: 'manual', status: 'canceled' }]);
    const blocked = await rejected(asUser(ctx.db, ctx.admin, (tx) => rpc(tx, 'admin_set_pro', { p_business_id: ctx.a.business_id, p_enabled: true, p_until: null })));
    expect(blocked.message).toMatch(/provider_subscription_exists/);
  });
});

describe('admin tools', () => {
  let ctx;
  beforeAll(async () => { ctx = await setup(); });

  it('creates company, location and plates in one go, with readable unique codes', async () => {
    const result = await asUser(ctx.db, ctx.admin, (tx) => rpc(tx, 'admin_create_bundle', {
      p_company_name: 'Spa Lotus Sdn Bhd', p_owner_email: 'mei@spalotus.my', p_contact_name: 'Mei', p_phone: '+60111222333',
      p_business_name: 'Spa Lotus KLCC', p_address: 'KLCC', p_review_url: 'https://maps.app.goo.gl/AbC123',
      p_plate_count: 3, p_plate_label: 'Reception', p_pro: true, p_pro_until: null, p_company_id: null,
    }));
    expect(result.existing_company).toBe(false);
    expect(result.plates).toHaveLength(3);
    const codes = result.plates.map((p) => p.code);
    expect(new Set(codes).size).toBe(3);
    for (const code of codes) expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/);
    expect(await ctx.isPro(result.business_id)).toBe(true);
    const owner = await rejected(asUser(ctx.db, ctx.owner, (tx) => rpc(tx, 'admin_create_bundle', {
      p_company_name: 'x', p_owner_email: null, p_contact_name: null, p_phone: null, p_business_name: 'x', p_address: null,
      p_review_url: 'https://g.page/x', p_plate_count: 1, p_plate_label: null, p_pro: true, p_pro_until: null, p_company_id: null,
    })));
    expect(owner.message).toMatch(/not_allowed/);
    const bad = await rejected(asUser(ctx.db, ctx.admin, (tx) => rpc(tx, 'admin_create_bundle', {
      p_company_name: 'x', p_owner_email: null, p_contact_name: null, p_phone: null, p_business_name: 'x', p_address: null,
      p_review_url: 'https://example.com', p_plate_count: 1, p_plate_label: null, p_pro: false, p_pro_until: null, p_company_id: null,
    })));
    expect(bad.message).toMatch(/invalid_review_url/);
  });

  it('lists customers, plates and subscriptions in one call each', async () => {
    const customers = await asUser(ctx.db, ctx.admin, (tx) => rpc(tx, 'admin_list_customers', { p_search: null, p_limit: 50, p_offset: 0 }));
    expect(customers.total).toBe(2);
    expect(customers.rows.find((c) => c.owner_email === 'owner@kopi.my').businesses).toHaveLength(2);
    const search = await asUser(ctx.db, ctx.admin, (tx) => rpc(tx, 'admin_list_customers', { p_search: 'LOTUS', p_limit: 50, p_offset: 0 }));
    expect(search.rows.map((c) => c.name)).toEqual(['Spa Lotus Sdn Bhd']);
    const wildcard = await asUser(ctx.db, ctx.admin, (tx) => rpc(tx, 'admin_list_customers', { p_search: '%', p_limit: 50, p_offset: 0 }));
    expect(wildcard.total).toBe(0); // % is searched literally
    const plates = await asUser(ctx.db, ctx.admin, (tx) => rpc(tx, 'admin_list_plates', { p_search: 'reception', p_limit: 100, p_offset: 0 }));
    expect(plates.total).toBe(3);
    const subs = await asUser(ctx.db, ctx.admin, (tx) => rpc(tx, 'admin_list_subscriptions', { p_limit: 50 }));
    expect(subs).toHaveLength(1);
    const overview = await asUser(ctx.db, ctx.admin, (tx) => rpc(tx, 'admin_overview'));
    expect(overview).toMatchObject({ companies: 2, businesses: 3, plates: 5, pro_locations: 1 });
    const detail = await asUser(ctx.db, ctx.admin, (tx) => rpc(tx, 'admin_get_customer', { p_company_id: ctx.a.company_id }));
    expect(detail.company.owner_email).toBe('owner@kopi.my');
    expect(detail.businesses).toHaveLength(2);
    for (const fn of ['admin_list_customers', 'admin_overview']) {
      const denied = await rejected(asUser(ctx.db, ctx.owner, (tx) => tx.query(`select public.${fn}()`)));
      expect(denied.message).toMatch(/not_allowed/);
    }
  });

  it('adds plates, moves a plate to another location, and only deletes a plate that was never scanned', async () => {
    const added = await asUser(ctx.db, ctx.admin, (tx) => rpc(tx, 'admin_add_plates', { p_business_id: ctx.a.business_id, p_count: 2, p_label: 'Table' }));
    expect(added.plates).toHaveLength(2);
    const [moved, scanned] = added.plates;
    await ctx.db.query("update public.businesses set review_url = 'https://g.page/r/ttdi/review' where id = $1", [ctx.b.business_id]);
    await asUser(ctx.db, ctx.admin, (tx) => rpc(tx, 'admin_move_plate', { p_plate_id: moved.id, p_business_id: ctx.b.business_id }));
    const row = (await ctx.db.query('select business_id, business_name, destination_url from public.plates where id = $1', [moved.id])).rows[0];
    expect(row).toEqual({ business_id: ctx.b.business_id, business_name: 'Kopi TTDI', destination_url: 'https://g.page/r/ttdi/review' });
    await ctx.db.query('select public.record_scan($1, $2)', [scanned.code, 'nfc']);
    const refused = await rejected(asUser(ctx.db, ctx.admin, (tx) => rpc(tx, 'admin_delete_plate', { p_plate_id: scanned.id })));
    expect(refused.message).toMatch(/plate_has_scans/);
    await asUser(ctx.db, ctx.admin, (tx) => rpc(tx, 'admin_delete_plate', { p_plate_id: moved.id }));
    expect((await ctx.db.query('select count(*)::int as n from public.plates where id = $1', [moved.id])).rows[0].n).toBe(0);
  });

  it('changes a customer login email and attaches an existing login immediately', async () => {
    const mei = await createUser(ctx.db, 'mei.new@spalotus.my');
    const company = (await ctx.db.query("select id from public.companies where owner_email = 'mei@spalotus.my'")).rows[0].id;
    await asUser(ctx.db, ctx.admin, (tx) => rpc(tx, 'admin_set_company_email', { p_company_id: company, p_email: 'Mei.New@spalotus.my' }));
    const data = await asUser(ctx.db, mei, (tx) => rpc(tx, 'dashboard_bootstrap'));
    expect(data.businesses.map((b) => b.name)).toEqual(['Spa Lotus KLCC']);
    const taken = await rejected(asUser(ctx.db, ctx.admin, (tx) => rpc(tx, 'admin_set_company_email', { p_company_id: company, p_email: 'owner@kopi.my' })));
    expect(taken.message).toMatch(/email_in_use/);
  });
});
