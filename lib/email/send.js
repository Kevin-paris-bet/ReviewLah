// Transactional email through Resend (https://resend.com). Configured with RESEND_API_KEY and
// EMAIL_FROM in the environment. When it is not configured, sending is skipped and reported as such.
import { resendConfig, supportEmail } from '../env';

/**
 * Returns { ok: true, id } | { ok: false, skipped: true } | { ok: false, error }.
 * idempotencyKey makes a retry of the same email safe (Resend ignores the duplicate for 24 hours).
 */
export async function sendEmail({ to, subject, html, text, replyTo, idempotencyKey, headers }) {
  const config = resendConfig();
  if (!config.apiKey) return { ok: false, skipped: true };
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: config.from,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
        text,
        reply_to: replyTo || config.replyTo || undefined,
        headers,
      }),
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, error: body?.message || `Resend answered ${response.status}` };
    return { ok: true, id: body?.id || null };
  } catch (error) {
    return { ok: false, error: error?.message || 'network error' };
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Forwards a support request from the dashboard to the support mailbox (SUPPORT_EMAIL). */
export async function notifySupport({ from, topic, message }) {
  const to = supportEmail();
  if (!to) return { ok: false, skipped: true };
  return sendEmail({
    to,
    replyTo: from,
    subject: `[ReviewLah support] ${topic} — ${from}`,
    text: `From: ${from}\nTopic: ${topic}\n\n${message}`,
    html: `<p><strong>From:</strong> ${escapeHtml(from)}<br><strong>Topic:</strong> ${escapeHtml(topic)}</p><p style="white-space:pre-wrap">${escapeHtml(message)}</p>`,
  });
}

export { escapeHtml };
