import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { airwallex, signWebhook, verifySignature, normalizeEvent, normalizeSubscription, normalizeInvoice } from '../lib/payments/airwallex.js';
import { createDb, createUser, makeAdmin, asUser, asService, rpc } from './helpers/db.js';

const SECRET = 'whsec_test_secret';

beforeEach(() => {
  Object.assign(process.env, {
    AIRWALLEX_CLIENT_ID: 'client', AIRWALLEX_API_KEY: 'key', AIRWALLEX_WEBHOOK_SECRET: SECRET,
    AIRWALLEX_PRICE_MONTHLY: 'pri_month', AIRWALLEX_PRICE_YEARLY: 'pri_year', AIRWALLEX_ENV: 'sandbox',
  });
});

const subscriptionEvent = (name, object, id = `evt_${name}`) => ({
  id, name, account_id: 'acct_1', created_at: '2026-11-17T04:00:00+0000', data: { object },
});
const sub = (overrides = {}) => ({
  id: 'sub_1', status: 'ACTIVE', billing_customer_id: 'bcus_1', recurring: { period: 1, period_unit: 'YEAR' },
  current_period_starts_at: '2026-11-17T04:00:00+0000', current_period_ends_at: '2027-11-17T04:00:00+0000',
  cancel_at_period_end: false, metadata: { business_id: '11111111-1111-4111-8111-111111111111' }, ...overrides,
});

describe('Airwallex webhook signature', () => {
  const body = JSON.stringify(subscriptionEvent('subscription.active', sub()));
  const now = 1794888000000;
  const timestamp = String(now - 1000);

  it('accepts a body signed with the endpoint secret', () => {
    const signature = signWebhook(SECRET, timestamp, body);
    expect(verifySignature({ secret: SECRET, timestamp, signature, rawBody: body, now })).toBe(true);
  });

  it('rejects a modified body, a wrong secret, a missing header and an old delivery', () => {
    const signature = signWebhook(SECRET, timestamp, body);
    expect(verifySignature({ secret: SECRET, timestamp, signature, rawBody: body.replace('ACTIVE', 'ACTIVE '), now })).toBe(false);
    expect(verifySignature({ secret: 'other', timestamp, signature, rawBody: body, now })).toBe(false);
    expect(verifySignature({ secret: SECRET, timestamp, signature: '', rawBody: body, now })).toBe(false);
    expect(verifySignature({ secret: '', timestamp, signature, rawBody: body, now })).toBe(false);
    const old = String(now - 6 * 60 * 1000);
    expect(verifySignature({ secret: SECRET, timestamp: old, signature: signWebhook(SECRET, old, body), rawBody: body, now })).toBe(false);
  });

  it('is what the adapter checks on a request', () => {
    const ts = String(Date.now());
    const headers = new Headers({ 'x-timestamp': ts, 'x-signature': signWebhook(SECRET, ts, body) });
    expect(airwallex.verifyWebhook({ rawBody: body, headers })).toBe(true);
    expect(airwallex.verifyWebhook({ rawBody: `${body} `, headers })).toBe(false);
    expect(airwallex.verifyWebhook({ rawBody: body, headers: new Headers() })).toBe(false);
  });
});

describe('Airwallex events, translated for billing_apply_event', () => {
  it('maps subscription statuses, period and renewal flag', () => {
    const active = normalizeEvent(subscriptionEvent('subscription.active', sub()));
    expect(active).toMatchObject({ id: 'evt_subscription.active', type: 'subscription.active' });
    expect(active.normalized).toMatchObject({
      kind: 'subscription', business_id: '11111111-1111-4111-8111-111111111111', provider_subscription_id: 'sub_1',
      provider_customer_id: 'bcus_1', status: 'active', billing_interval: 'year',
      current_period_start: '2026-11-17T04:00:00.000Z', current_period_end: '2027-11-17T04:00:00.000Z',
      cancel_at_period_end: false, occurred_at: '2026-11-17T04:00:00.000Z',
    });
    expect(normalizeSubscription(sub({ status: 'UNPAID' })).status).toBe('past_due');
    expect(normalizeSubscription(sub({ status: 'IN_TRIAL' })).status).toBe('trialing');
    expect(normalizeSubscription(sub({ status: 'PENDING' })).status).toBe('incomplete');
    expect(normalizeSubscription(sub({ status: 'CANCELLED', cancel_requested_at: '2026-12-01T00:00:00+0000' }))).toMatchObject({ status: 'canceled', canceled_at: '2026-12-01T00:00:00.000Z' });
    expect(normalizeSubscription(sub({ status: 'SOMETHING_NEW' }))).toEqual({ kind: 'ignore' });
  });

  it('maps invoices to payments in cents', () => {
    const invoice = { id: 'inv_1', number: 'INV-0007', status: 'FINALIZED', payment_status: 'PAID', subscription_id: 'sub_1', currency: 'MYR', total_amount: 290, paid_at: '2026-11-17T04:01:00+0000', hosted_url: 'https://checkout.airwallex.com/i/inv_1' };
    expect(normalizeEvent({ id: 'e1', name: 'invoice.paid', data: { object: invoice } }).normalized).toEqual({
      kind: 'payment', provider_payment_id: 'inv_1', provider_subscription_id: 'sub_1', business_id: null, status: 'succeeded',
      amount_cents: 29000, currency: 'MYR', paid_at: '2026-11-17T04:01:00.000Z',
      invoice_url: 'https://checkout.airwallex.com/i/inv_1', description: 'ReviewLah Pro — invoice INV-0007',
    });
    const unpaid = { ...invoice, payment_status: 'UNPAID', paid_at: null, total_amount: 29.9 };
    expect(normalizeInvoice(unpaid, 'invoice.payment_attempt_failed')).toMatchObject({ status: 'failed', amount_cents: 2990, paid_at: null });
    expect(normalizeInvoice(unpaid, 'invoice.finalized')).toMatchObject({ status: 'pending' });
    expect(normalizeInvoice({ ...unpaid, status: 'DRAFT' }, 'invoice.created')).toEqual({ kind: 'ignore' });
    expect(normalizeInvoice({ ...unpaid, status: 'VOIDED' }, 'invoice.voided')).toEqual({ kind: 'ignore' });
  });

  it('ignores events it does not know and refuses a payload without an id', () => {
    expect(normalizeEvent({ id: 'e2', name: 'payment_intent.succeeded', data: { object: {} } }).normalized).toEqual({ kind: 'ignore' });
    expect(() => airwallex.parseWebhook(JSON.stringify({ name: 'subscription.active', data: {} }))).toThrow();
    expect(() => airwallex.parseWebhook('not json')).toThrow();
  });
});

describe('Airwallex checkout and renewal calls', () => {
  function fakeFetch(calls) {
    return async (url, init) => {
      calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
      const json = (data, status = 200) => ({ ok: status < 300, status, json: async () => data });
      if (url.endsWith('/authentication/login')) return json({ token: 'tok', expires_at: new Date(Date.now() + 1800000).toISOString() }, 201);
      if (url.endsWith('/billing_checkouts/create')) return json({ id: 'bco_1', url: 'https://checkout.airwallex.com/bco_1', status: 'ACTIVE', billing_customer_id: null }, 201);
      if (url.endsWith('/billing_checkouts/bco_1')) return json({ id: 'bco_1', status: 'COMPLETED', subscription_id: 'sub_1', metadata: { business_id: 'b' } });
      if (url.endsWith('/subscriptions/sub_1')) return json(sub({ metadata: {} }));
      if (url.endsWith('/subscriptions/sub_1/update')) return json(sub({ cancel_at_period_end: true }));
      return json({ message: 'not found' }, 404);
    };
  }

  it('opens a hosted subscription checkout for one location with the right price', async () => {
    const calls = [];
    const result = await airwallex.createCheckout({
      subscriptionRef: 'row-1', businessId: 'biz-1', businessName: 'Kopi Bangsar', companyId: 'co-1', companyName: 'Kopi Sdn Bhd',
      interval: 'year', email: 'owner@kopi.my', customerId: null,
      successUrl: 'https://www.reviewlah.my/dashboard/billing/return?location=biz-1', cancelUrl: 'https://www.reviewlah.my/dashboard/billing',
    }, { fetchImpl: fakeFetch(calls) });
    expect(result).toEqual({ checkoutId: 'bco_1', url: 'https://checkout.airwallex.com/bco_1', customerId: null });
    const create = calls.find((c) => c.url.endsWith('/billing_checkouts/create'));
    expect(create.url).toBe('https://api.sandbox.airwallex.com/api/v1/billing/billing_checkouts/create');
    expect(create.headers.Authorization).toBe('Bearer tok');
    expect(create.body).toMatchObject({
      mode: 'SUBSCRIPTION', line_items: [{ price_id: 'pri_year', quantity: 1 }],
      metadata: { business_id: 'biz-1', company_id: 'co-1', subscription_ref: 'row-1' },
      subscription_data: { metadata: { business_id: 'biz-1' } },
      customer_data: { email: 'owner@kopi.my', name: 'Kopi Sdn Bhd', type: 'BUSINESS' },
    });
    expect(create.body.request_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('reuses the customer already known at the provider and the monthly price', async () => {
    const calls = [];
    await airwallex.createCheckout({ subscriptionRef: 'r', businessId: 'b', companyId: 'c', interval: 'month', email: 'o@k.my', customerId: 'bcus_9', successUrl: 's', cancelUrl: 'c' }, { fetchImpl: fakeFetch(calls) });
    const body = calls.find((c) => c.url.endsWith('/create')).body;
    expect(body.billing_customer_id).toBe('bcus_9');
    expect(body.customer_data).toBeUndefined();
    expect(body.line_items[0].price_id).toBe('pri_month');
  });

  it('reads a completed checkout back as a subscription event', async () => {
    const event = await airwallex.fetchCheckout('bco_1', { fetchImpl: fakeFetch([]) });
    expect(event).toMatchObject({ id: 'checkout:bco_1:ACTIVE', normalized: { kind: 'subscription', status: 'active', provider_checkout_id: 'bco_1', provider_subscription_id: 'sub_1', business_id: 'b' } });
  });

  it('stops the renewal through the subscription update endpoint', async () => {
    const calls = [];
    await airwallex.setCancelAtPeriodEnd('sub_1', true, { fetchImpl: fakeFetch(calls) });
    const update = calls.find((c) => c.url.endsWith('/subscriptions/sub_1/update'));
    expect(update.body).toMatchObject({ cancel_at_period_end: true });
  });
});

describe('Airwallex events applied to the database', () => {
  let db; let business; let owner;
  const isPro = async () => (await db.query('select public.business_is_pro($1) as pro', [business.business_id])).rows[0].pro;
  const apply = (event) => {
    const parsed = airwallex.parseWebhook(JSON.stringify(event));
    return asService(db, (tx) => rpc(tx, 'billing_apply_event', {
      p_provider: 'airwallex', p_event_id: parsed.id, p_event_type: parsed.type, p_payload: parsed.payload, p_normalized: parsed.normalized,
    }));
  };
  const at = (days) => new Date(Date.now() + days * 86400000).toISOString();

  beforeAll(async () => {
    db = await createDb();
    const admin = await createUser(db, 'admin@reviewlah.my');
    await makeAdmin(db, admin);
    owner = await createUser(db, 'owner@kopi.my');
    business = await asUser(db, admin, (tx) => rpc(tx, 'admin_create_bundle', {
      p_company_name: 'Kopi', p_owner_email: 'owner@kopi.my', p_contact_name: null, p_phone: null, p_business_name: 'Kopi Bangsar',
      p_address: null, p_review_url: 'https://g.page/r/kopi/review', p_plate_count: 1, p_plate_label: null, p_pro: false, p_pro_until: null, p_company_id: null,
    }));
    await asUser(db, owner, (tx) => rpc(tx, 'claim_account'));
  });

  it('checkout, payment, failed renewal, recovery and cancellation', async () => {
    const pending = await asUser(db, owner, (tx) => rpc(tx, 'billing_begin_checkout', { p_business_id: business.business_id, p_interval: 'month', p_provider: 'airwallex' }));
    await asUser(db, owner, (tx) => rpc(tx, 'billing_attach_checkout', { p_subscription_id: pending.subscription_id, p_checkout_id: 'bco_9', p_customer_id: null }));
    expect(await isPro()).toBe(false);

    const meta = { business_id: business.business_id, subscription_ref: pending.subscription_id };
    const object = (o) => sub({ id: 'sub_9', metadata: meta, recurring: { period: 1, period_unit: 'MONTH' }, current_period_starts_at: at(0), current_period_ends_at: at(30), ...o });

    let r = await apply({ ...subscriptionEvent('subscription.active', object({}), 'evt_a'), created_at: at(0) });
    expect(r).toMatchObject({ outcome: 'applied', status: 'active', previous_status: 'incomplete', subscription_id: pending.subscription_id });
    expect(await isPro()).toBe(true);
    expect((await apply({ ...subscriptionEvent('subscription.active', object({}), 'evt_a'), created_at: at(0) })).outcome).toBe('duplicate');

    r = await apply({ id: 'evt_inv', name: 'invoice.paid', created_at: at(0), data: { object: { id: 'inv_9', number: 'INV-1', status: 'FINALIZED', payment_status: 'PAID', subscription_id: 'sub_9', currency: 'MYR', total_amount: 29, paid_at: at(0) } } });
    expect(r).toMatchObject({ outcome: 'applied', kind: 'payment', business_id: business.business_id, status: 'succeeded' });
    const payments = await asUser(db, owner, (tx) => tx.query('select amount_cents, status from public.payments'));
    expect(payments.rows).toEqual([{ amount_cents: 2900, status: 'succeeded' }]);

    r = await apply({ ...subscriptionEvent('subscription.unpaid', object({ status: 'UNPAID' }), 'evt_b'), created_at: at(0.01) });
    expect(r).toMatchObject({ status: 'past_due', previous_status: 'active' });
    expect(await isPro()).toBe(true); // retries are running: Pro stays on

    // A late, older event must not undo the newer state.
    expect((await apply({ ...subscriptionEvent('subscription.active', object({}), 'evt_late'), created_at: at(0.005) })).outcome).toBe('ignored');

    r = await apply({ ...subscriptionEvent('subscription.active', object({}), 'evt_c'), created_at: at(0.02) });
    expect(r).toMatchObject({ status: 'active', previous_status: 'past_due' });

    r = await apply({ ...subscriptionEvent('subscription.cancelled', object({ status: 'CANCELLED' }), 'evt_d'), created_at: at(0.03) });
    expect(r).toMatchObject({ status: 'canceled' });
    expect(await isPro()).toBe(false);
    // The plate itself is untouched by any of this.
    const plate = (await db.query('select active, destination_url from public.plates where business_id = $1', [business.business_id])).rows[0];
    expect(plate).toEqual({ active: true, destination_url: 'https://g.page/r/kopi/review' });
  });
});
