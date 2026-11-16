// Sends the monthly summary to every customer with at least one Pro location.
// Safe to run several times for the same month: a customer who already received it is skipped
// (email_log), and Resend ignores a duplicate of the same message for 24 hours.
import { buildMonthlySummary } from './monthly';
import { sendEmail } from './send';
import { resendConfig, siteUrl, legalEntity, gbpEnabled } from '../env';
import { isValidEmail } from '../validation';

const KIND = 'monthly_summary';

/**
 * admin: service-role client. month: 'YYYY-MM-01' (Malaysia calendar month).
 * companyId: only this customer. force: send again even if already sent (admin test).
 * to: send to this address instead of the customer's (admin test). deadline: stop before this time (ms).
 */
export async function sendMonthlySummaries(admin, { month, companyId = null, force = false, to = null, deadline = Infinity } = {}) {
  const period = String(month).slice(0, 7);
  const result = { period, candidates: 0, sent: 0, already_sent: 0, failed: 0, remaining: 0 };
  if (!resendConfig().apiKey) return { ...result, skipped: 'RESEND_API_KEY is not configured' };

  const { data, error } = await admin.rpc('monthly_summary_data', { p_month: month });
  if (error) return { ...result, error: error.message };
  let entries = Array.isArray(data) ? data : [];
  if (companyId) entries = entries.filter((e) => e.company_id === companyId);
  result.candidates = entries.length;
  if (!entries.length) return result;

  let reviews = {};
  if (gbpEnabled()) {
    const r = await admin.rpc('monthly_review_data', { p_month: month });
    if (!r.error && r.data && typeof r.data === 'object') reviews = r.data;
  }

  let done = new Set();
  if (!force) {
    const { data: log } = await admin.from('email_log').select('company_id').eq('kind', KIND).eq('period', period).eq('status', 'sent');
    done = new Set((log || []).map((row) => row.company_id));
  }

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (done.has(entry.company_id)) {
      result.already_sent += 1;
      continue;
    }
    if (Date.now() > deadline) {
      result.remaining = entries.length - i;
      break;
    }
    const recipient = to || entry.email;
    if (!isValidEmail(recipient)) {
      result.failed += 1;
      continue;
    }
    const message = buildMonthlySummary(entry, { reviews, siteUrl: siteUrl(), legalName: legalEntity().name });
    const sent = await sendEmail({
      to: recipient,
      subject: message.subject,
      html: message.html,
      text: message.text,
      idempotencyKey: force ? undefined : `${KIND}-${entry.company_id}-${period}`,
    });
    await admin.from('email_log').insert({
      company_id: entry.company_id,
      kind: force ? `${KIND}_test` : KIND,
      period: force ? '' : period,
      to_email: recipient,
      status: sent.ok ? 'sent' : 'failed',
      provider_id: sent.ok ? sent.id : null,
      error: sent.ok ? null : String(sent.error || 'not sent').slice(0, 300),
    });
    if (sent.ok) result.sent += 1;
    else result.failed += 1;
  }
  return result;
}
