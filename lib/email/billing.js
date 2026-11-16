// Emails sent when a payment provider event changes a subscription: Pro switched on, a renewal
// payment failed, Pro ended. Best effort: the subscription state never depends on an email.
import { sendEmail } from './send';
import { simpleEmail } from './layout';
import { siteUrl } from '../env';
import { formatDate } from '../time';
import { PRO_PRICES } from '../plans';
import { isValidEmail } from '../validation';

const PROMISE = 'Your plate and your Basic dashboard keep working in every case.';

export function billingMessage(kind, { businessName, interval, periodEnd, invoiceUrl }) {
  const plan = `${siteUrl()}/dashboard/billing`;
  if (kind === 'activated') {
    const price = PRO_PRICES[interval]?.label;
    return {
      subject: `Pro is on for ${businessName}`,
      ...simpleEmail({
        heading: `Pro is on for ${businessName}`,
        paragraphs: [
          `Thank you. Your payment went through and Pro is active for ${businessName}${price ? ` (${price})` : ''}.`,
          periodEnd ? `It renews on ${formatDate(periodEnd)}. You can cancel the renewal at any time from your dashboard.` : 'You can cancel the renewal at any time from your dashboard.',
          PROMISE,
        ],
        button: { href: `${siteUrl()}/dashboard/analytics`, text: 'Open your analytics' },
      }),
    };
  }
  if (kind === 'payment_failed') {
    return {
      subject: `Payment issue for ReviewLah Pro (${businessName})`,
      ...simpleEmail({
        heading: 'We could not renew Pro',
        paragraphs: [
          `The renewal payment for ${businessName} did not go through. It will be tried again automatically over the next days, and Pro stays on in the meantime.`,
          invoiceUrl ? 'You can also pay the invoice now, or use another card, with the button below.' : 'You can check your plan and payments in your dashboard.',
          `If the payment still fails, Pro switches off for this location. ${PROMISE}`,
        ],
        button: invoiceUrl ? { href: invoiceUrl, text: 'Pay the invoice' } : { href: plan, text: 'Open plan and payments' },
      }),
    };
  }
  return {
    subject: `Pro has ended for ${businessName}`,
    ...simpleEmail({
      heading: `Pro has ended for ${businessName}`,
      paragraphs: [
        `Pro is now off for ${businessName}. ${PROMISE}`,
        'Your scan history is kept. You can switch Pro back on whenever you like.',
      ],
      button: { href: plan, text: 'Open plan and payments' },
    }),
  };
}

/** result: what billing_apply_event returned. Decides whether an email is due and sends it. */
export async function notifyBillingChange(admin, result) {
  if (!result || result.outcome !== 'applied' || result.kind !== 'subscription' || !result.business_id) return null;
  const before = result.previous_status || null;
  const now = result.status;
  let kind = null;
  if (now === 'active' && (before === null || before === 'incomplete')) kind = 'activated';
  else if (now === 'past_due' && before !== 'past_due') kind = 'payment_failed';
  else if (now === 'canceled' && before && before !== 'canceled' && before !== 'incomplete') kind = 'ended';
  if (!kind) return null;

  const { data: business } = await admin.from('businesses').select('name,company_id').eq('id', result.business_id).maybeSingle();
  if (!business) return null;
  const { data: company } = await admin.from('companies').select('owner_email').eq('id', business.company_id).maybeSingle();
  if (!isValidEmail(company?.owner_email)) return null;
  const { data: sub } = await admin.from('subscriptions').select('billing_interval,current_period_end').eq('id', result.subscription_id).maybeSingle();
  let invoiceUrl = null;
  if (kind === 'payment_failed') {
    const { data: payments } = await admin.from('payments').select('invoice_url,status,created_at').eq('business_id', result.business_id).neq('status', 'succeeded').order('created_at', { ascending: false }).limit(1);
    invoiceUrl = payments?.[0]?.invoice_url || null;
  }
  const message = billingMessage(kind, { businessName: business.name, interval: sub?.billing_interval, periodEnd: sub?.current_period_end, invoiceUrl });
  const sent = await sendEmail({ to: company.owner_email, ...message, idempotencyKey: `billing-${kind}-${result.subscription_id}-${String(sub?.current_period_end || '').slice(0, 10)}` });
  if (!sent.skipped) {
    await admin.from('email_log').insert({
      company_id: business.company_id, kind: `billing_${kind}`, period: '', to_email: company.owner_email,
      status: sent.ok ? 'sent' : 'failed', provider_id: sent.ok ? sent.id : null, error: sent.ok ? null : String(sent.error || '').slice(0, 300),
    });
  }
  return kind;
}
