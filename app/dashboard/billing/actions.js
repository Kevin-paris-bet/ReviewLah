'use server';
// Subscription actions of the business owner. Pro is never granted here: a checkout only opens
// a pending row, and the provider webhook (or the verified return from the checkout) confirms it.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { errorCode } from '../../../lib/dashboard';
import { isUuid } from '../../../lib/validation';
import { isInterval } from '../../../lib/plans';
import { siteUrl } from '../../../lib/env';
import { checkoutProvider, providerByName } from '../../../lib/payments';
import { session, go, text } from '../../../lib/action-helpers';

export async function startCheckout(formData) {
  const { supabase } = await session();
  const id = text(formData, 'business_id', 40);
  const interval = text(formData, 'interval', 10);
  if (!isUuid(id)) redirect('/dashboard/billing');
  const back = `/dashboard/billing?location=${id}`;
  if (!isInterval(interval)) go(back, 'error', 'invalid_interval');
  const provider = checkoutProvider();
  if (!provider) go(back, 'error', 'payment_unavailable');

  const { data: pending, error } = await supabase.rpc('billing_begin_checkout', { p_business_id: id, p_interval: interval, p_provider: provider.name });
  if (error) go(back, 'error', errorCode(error));

  let checkout;
  try {
    checkout = await provider.createCheckout({
      subscriptionRef: pending.subscription_id,
      businessId: pending.business_id,
      businessName: pending.business_name,
      companyId: pending.company_id,
      companyName: pending.company_name,
      interval,
      email: pending.email,
      customerId: pending.provider_customer_id,
      successUrl: `${siteUrl()}/dashboard/billing/return?location=${id}`,
      cancelUrl: `${siteUrl()}/dashboard/billing?location=${id}&error=payment_cancelled`,
    });
  } catch (e) {
    console.error('[billing] checkout could not be opened', e?.message);
    go(back, 'error', 'payment_failed');
  }
  const attached = await supabase.rpc('billing_attach_checkout', {
    p_subscription_id: pending.subscription_id, p_checkout_id: checkout.checkoutId, p_customer_id: checkout.customerId,
  });
  if (attached.error) go(back, 'error', 'payment_failed');
  redirect(checkout.url);
}

// Cancels (or resumes) the renewal. Pro stays on until the end of the paid period, and the
// plate and the Basic dashboard are never affected.
export async function setRenewal(formData) {
  const { supabase } = await session();
  const id = text(formData, 'subscription_id', 40);
  const cancel = formData.get('cancel') === 'true';
  const back = '/dashboard/billing';
  if (!isUuid(id)) redirect(back);
  const { data: sub } = await supabase.from('subscriptions').select('id,provider,provider_subscription_id,status').eq('id', id).maybeSingle();
  if (!sub) go(back, 'error', 'not_allowed');
  if (sub.provider === 'manual') go(back, 'error', 'managed_by_support');
  const provider = providerByName(sub.provider);
  if (!provider || !sub.provider_subscription_id) go(back, 'error', 'provider_unreachable');
  try {
    await provider.setCancelAtPeriodEnd(sub.provider_subscription_id, cancel);
  } catch (e) {
    console.error('[billing] renewal change failed', e?.message);
    go(back, 'error', 'provider_unreachable');
  }
  const { error } = await supabase.rpc('billing_set_cancel', { p_subscription_id: id, p_cancel: cancel });
  if (error) go(back, 'error', errorCode(error));
  revalidatePath('/dashboard', 'layout');
  go(back, 'ok', cancel ? 'cancel' : 'resume');
}
