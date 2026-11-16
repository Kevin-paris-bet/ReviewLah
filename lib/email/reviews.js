// Alert sent when Google announces a new review for a linked, Pro location.
import { sendEmail } from './send';
import { simpleEmail } from './layout';
import { siteUrl } from '../env';
import { isValidEmail } from '../validation';

const stars = (rating) => (rating ? `${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}` : 'No rating');

export function buildReviewAlert({ businessId, businessName, reviews }) {
  const list = reviews.slice(0, 5);
  const one = reviews.length === 1;
  const subject = one
    ? `New Google review for ${businessName}${list[0].rating ? `: ${list[0].rating} ${list[0].rating === 1 ? 'star' : 'stars'}` : ''}`
    : `${reviews.length} new Google reviews for ${businessName}`;
  const paragraphs = list.map((r) => {
    const text = String(r.comment || '').trim();
    return `${stars(r.rating)}  ${r.reviewer_name || 'Google user'}\n${text ? (text.length > 400 ? `${text.slice(0, 400)}…` : text) : '(rating only, no text)'}`;
  });
  if (reviews.length > list.length) paragraphs.push(`…and ${reviews.length - list.length} more.`);
  paragraphs.push('You can read it, prepare a reply and publish it from your dashboard. Nothing is ever published without your approval.');
  return {
    subject,
    ...simpleEmail({
      heading: one ? `New Google review for ${businessName}` : `${reviews.length} new Google reviews for ${businessName}`,
      paragraphs,
      button: { href: `${siteUrl()}/dashboard/reviews?location=${businessId}&filter=unreplied`, text: 'Open reviews' },
      footer: 'You receive this email because new-review alerts are on. Turn them off in your ReviewLah account.',
    }),
  };
}

/** Sends one alert for the new reviews of one location, then marks them as alerted. */
export async function sendReviewAlert(admin, { companyId, to, businessId, businessName, reviews }) {
  if (!reviews.length || !isValidEmail(to)) return { ok: false, skipped: true };
  const message = buildReviewAlert({ businessId, businessName, reviews });
  const sent = await sendEmail({ to, ...message, idempotencyKey: `review-alert-${reviews[0].id}` });
  if (sent.skipped) return sent;
  await admin.from('email_log').insert({
    company_id: companyId, kind: 'review_alert', period: '', to_email: to,
    status: sent.ok ? 'sent' : 'failed', provider_id: sent.ok ? sent.id : null, error: sent.ok ? null : String(sent.error || '').slice(0, 300),
  });
  if (sent.ok) {
    await admin.from('google_reviews').update({ alerted_at: new Date().toISOString() }).in('id', reviews.map((r) => r.id));
  }
  return sent;
}
