// Airwallex Billing adapter (hosted Billing Checkout + Subscriptions + webhooks).
// Docs: https://www.airwallex.com/docs/billing — endpoints under /api/v1/billing/...
//
// Environment (Vercel): AIRWALLEX_CLIENT_ID, AIRWALLEX_API_KEY, AIRWALLEX_WEBHOOK_SECRET,
// AIRWALLEX_PRICE_MONTHLY, AIRWALLEX_PRICE_YEARLY, and optionally AIRWALLEX_ENV=sandbox,
// AIRWALLEX_LEGAL_ENTITY_ID, AIRWALLEX_LINKED_PAYMENT_ACCOUNT_ID, AIRWALLEX_API_VERSION.
// The two prices (RM29 / month, RM290 / year) are created once: see scripts/airwallex-setup.mjs.
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { airwallexConfig } from '../env.js';

const NAME = 'airwallex';
const WEBHOOK_TOLERANCE_MS = 5 * 60 * 1000;

// Airwallex subscription status -> ours.
const STATUS = { PENDING: 'incomplete', IN_TRIAL: 'trialing', ACTIVE: 'active', UNPAID: 'past_due', CANCELLED: 'canceled' };
const INTERVAL = { MONTH: 'month', YEAR: 'year' };

let cachedToken = { value: '', expiresAt: 0, key: '' };

async function accessToken(config, fetchImpl) {
  const key = `${config.baseUrl}|${config.clientId}`;
  if (cachedToken.value && cachedToken.key === key && cachedToken.expiresAt > Date.now() + 60000) return cachedToken.value;
  const response = await fetchImpl(`${config.baseUrl}/api/v1/authentication/login`, {
    method: 'POST',
    headers: { 'x-client-id': config.clientId, 'x-api-key': config.apiKey, 'Content-Type': 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.token) throw new Error(`Airwallex login failed (${response.status})`);
  const expires = Date.parse(body.expires_at || '') || Date.now() + 20 * 60000;
  cachedToken = { value: body.token, expiresAt: expires, key };
  return body.token;
}

async function call(path, { method = 'POST', body, fetchImpl = fetch } = {}) {
  const config = airwallexConfig();
  const token = await accessToken(config, fetchImpl);
  const response = await fetchImpl(`${config.baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(config.apiVersion ? { 'x-api-version': config.apiVersion } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`Airwallex ${method} ${path} answered ${response.status}: ${data?.message || data?.code || 'error'}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function toIso(value) {
  if (!value) return null;
  const time = typeof value === 'number' ? value : Date.parse(String(value).replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function cents(amount) {
  const n = Number(amount);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** A Subscription object (webhook data.object or API response) -> billing_apply_event JSON. */
export function normalizeSubscription(sub, occurredAt) {
  const status = STATUS[String(sub?.status || '').toUpperCase()];
  if (!sub?.id || !status) return { kind: 'ignore' };
  const meta = sub.metadata || {};
  return {
    kind: 'subscription',
    business_id: meta.business_id || null,
    provider_subscription_id: sub.id,
    provider_customer_id: sub.billing_customer_id || sub.customer_id || null,
    provider_checkout_id: meta.checkout_id || null,
    status,
    billing_interval: INTERVAL[String(sub.recurring?.period_unit || '').toUpperCase()] || null,
    current_period_start: toIso(sub.current_period_starts_at || sub.current_period_start_at),
    current_period_end: toIso(sub.current_period_ends_at || sub.current_period_end_at),
    cancel_at_period_end: typeof sub.cancel_at_period_end === 'boolean' ? sub.cancel_at_period_end : null,
    canceled_at: toIso(sub.cancel_requested_at || sub.cancelled_at),
    occurred_at: toIso(occurredAt) || toIso(sub.updated_at) || new Date().toISOString(),
  };
}

/** An Invoice object -> billing_apply_event JSON (one payment line per invoice). */
export function normalizeInvoice(invoice, eventName = '') {
  if (!invoice?.id) return { kind: 'ignore' };
  const paid = String(invoice.payment_status || '').toUpperCase() === 'PAID' || /(^|\.)paid$/.test(eventName);
  const failed = /failed/.test(eventName);
  const voided = String(invoice.status || '').toUpperCase() === 'VOIDED' || /voided/.test(eventName);
  if (String(invoice.status || '').toUpperCase() === 'DRAFT' && !paid) return { kind: 'ignore' };
  if (voided && !paid) return { kind: 'ignore' };
  return {
    kind: 'payment',
    provider_payment_id: invoice.id,
    provider_subscription_id: invoice.subscription_id || null,
    business_id: invoice.metadata?.business_id || null,
    status: paid ? 'succeeded' : failed ? 'failed' : 'pending',
    amount_cents: cents(invoice.total_amount ?? invoice.amount_due),
    currency: invoice.currency || 'MYR',
    paid_at: paid ? toIso(invoice.paid_at) || new Date().toISOString() : null,
    invoice_url: invoice.hosted_url || invoice.pdf_url || null,
    description: invoice.number ? `ReviewLah Pro — invoice ${invoice.number}` : 'ReviewLah Pro',
  };
}

/** A webhook event -> { id, type, payload, normalized }. */
export function normalizeEvent(event) {
  const type = String(event?.name || event?.type || '');
  const object = event?.data?.object || event?.data || {};
  let normalized = { kind: 'ignore' };
  if (type.startsWith('subscription.')) normalized = normalizeSubscription(object, event.created_at);
  else if (type.startsWith('invoice.')) normalized = normalizeInvoice(object, type);
  return { id: String(event?.id || ''), type, payload: event, normalized };
}

/** HMAC-SHA256 (hex) of x-timestamp + raw body, keyed with the endpoint's signing secret. */
export function signWebhook(secret, timestamp, rawBody) {
  return createHmac('sha256', secret).update(`${timestamp}${rawBody}`).digest('hex');
}

export function verifySignature({ secret, timestamp, signature, rawBody, now = Date.now() }) {
  if (!secret || !timestamp || !signature) return false;
  const sent = Number(timestamp);
  if (!Number.isFinite(sent) || Math.abs(now - sent) > WEBHOOK_TOLERANCE_MS) return false;
  const expected = Buffer.from(signWebhook(secret, timestamp, rawBody));
  const given = Buffer.from(String(signature).trim().toLowerCase());
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export const airwallex = {
  name: NAME,

  isConfigured() {
    const c = airwallexConfig();
    return Boolean(c.clientId && c.apiKey && c.priceMonthly && c.priceYearly);
  },

  canReceiveWebhooks() {
    return Boolean(airwallexConfig().webhookSecret);
  },

  async createCheckout(input, { fetchImpl = fetch } = {}) {
    const c = airwallexConfig();
    const priceId = input.interval === 'year' ? c.priceYearly : c.priceMonthly;
    const metadata = { business_id: input.businessId, company_id: input.companyId, subscription_ref: input.subscriptionRef };
    const body = {
      request_id: randomUUID(),
      mode: 'SUBSCRIPTION',
      line_items: [{ price_id: priceId, quantity: 1 }],
      success_url: input.successUrl,
      back_url: input.cancelUrl,
      metadata,
      subscription_data: { metadata },
      ...(input.customerId
        ? { billing_customer_id: input.customerId }
        : { customer_data: { email: input.email, name: input.companyName || input.businessName, type: 'BUSINESS' } }),
      ...(c.legalEntityId ? { legal_entity_id: c.legalEntityId } : {}),
      ...(c.linkedPaymentAccountId ? { linked_payment_account_id: c.linkedPaymentAccountId } : {}),
    };
    const data = await call('/api/v1/billing/billing_checkouts/create', { body, fetchImpl });
    if (!data.id || !data.url) throw new Error('Airwallex did not return a checkout address');
    return { checkoutId: data.id, url: data.url, customerId: data.billing_customer_id || input.customerId || null };
  },

  verifyWebhook({ rawBody, headers }) {
    return verifySignature({
      secret: airwallexConfig().webhookSecret,
      timestamp: headers.get('x-timestamp'),
      signature: headers.get('x-signature'),
      rawBody,
    });
  },

  parseWebhook(rawBody) {
    const event = normalizeEvent(JSON.parse(rawBody));
    if (!event.id) throw new Error('event without id');
    return event;
  },

  // After the customer returns from the hosted page: read the checkout, then its subscription.
  async fetchCheckout(checkoutId, { fetchImpl = fetch } = {}) {
    const checkout = await call(`/api/v1/billing/billing_checkouts/${encodeURIComponent(checkoutId)}`, { method: 'GET', fetchImpl });
    if (String(checkout.status).toUpperCase() !== 'COMPLETED' || !checkout.subscription_id) return null;
    const sub = await call(`/api/v1/billing/subscriptions/${encodeURIComponent(checkout.subscription_id)}`, { method: 'GET', fetchImpl });
    const normalized = normalizeSubscription(sub, sub.updated_at || checkout.completed_at);
    if (normalized.kind !== 'subscription') return null;
    normalized.provider_checkout_id = checkout.id;
    normalized.business_id = normalized.business_id || checkout.metadata?.business_id || null;
    return { id: `checkout:${checkout.id}:${sub.status}`, type: 'checkout.reconciled', payload: { checkout_id: checkout.id, subscription_id: sub.id }, normalized };
  },

  async setCancelAtPeriodEnd(providerSubscriptionId, cancel, { fetchImpl = fetch } = {}) {
    await call(`/api/v1/billing/subscriptions/${encodeURIComponent(providerSubscriptionId)}/update`, {
      body: { request_id: randomUUID(), cancel_at_period_end: Boolean(cancel) },
      fetchImpl,
    });
  },

  async cancelNow(providerSubscriptionId, { fetchImpl = fetch } = {}) {
    await call(`/api/v1/billing/subscriptions/${encodeURIComponent(providerSubscriptionId)}/cancel`, {
      body: { request_id: randomUUID(), proration_behavior: 'NONE' },
      fetchImpl,
    });
  },
};
