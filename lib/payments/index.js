// Payment layer. The app only talks to this file and to the provider-agnostic SQL functions
// (billing_begin_checkout, billing_attach_checkout, billing_apply_event, billing_set_cancel).
// Changing provider means writing one adapter and setting PAYMENT_PROVIDER: nothing else changes.
//
// An adapter is an object with:
//   name                         'airwallex'
//   isConfigured()               can it open a checkout? (API keys and prices present)
//   canReceiveWebhooks()         can it verify a webhook? (signing secret present)
//   createCheckout(input)        -> { checkoutId, url, customerId }
//       input: { subscriptionRef, businessId, businessName, companyId, companyName, interval,
//                email, customerId, successUrl, cancelUrl }
//   verifyWebhook({ rawBody, headers })   -> boolean   (signature and freshness)
//   parseWebhook(rawBody)        -> { id, type, payload, normalized }
//       normalized is the JSON understood by billing_apply_event (see migration 0004):
//       { kind: 'subscription' | 'payment' | 'ignore', ... }
//   fetchCheckout(checkoutId)    -> { id, type, payload, normalized } | null   (state after the
//                                   customer comes back, in case the webhook is late)
//   setCancelAtPeriodEnd(providerSubscriptionId, cancel)   stop / resume the renewal
//   cancelNow(providerSubscriptionId)                      end at once (admin)
import { paymentProviderName } from '../env';
import { airwallex } from './airwallex';

const ADAPTERS = { airwallex };

/** The adapter used for new checkouts (PAYMENT_PROVIDER), or null when online payment is not open. */
export function checkoutProvider() {
  const adapter = ADAPTERS[paymentProviderName()];
  return adapter && adapter.isConfigured() ? adapter : null;
}

/**
 * The adapter for an existing subscription or an incoming webhook. A previous provider keeps
 * working for its own subscriptions after PAYMENT_PROVIDER has moved to another one.
 */
export function providerByName(name) {
  return ADAPTERS[String(name || '').toLowerCase()] || null;
}

export function knownProviders() {
  return Object.keys(ADAPTERS);
}
