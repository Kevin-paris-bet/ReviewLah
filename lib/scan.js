// Helpers for the plate redirect (go.reviewlah.my/CODE).
import { createHash, createHmac } from 'node:crypto';

export const CODE_PATTERN = /^[A-Za-z0-9]{3,16}$/;

/** ?nfc is written on the chip, ?qr is printed in the QR code. Anything else is "other". */
export function scanSource(searchParams) {
  if (searchParams.has('nfc')) return 'nfc';
  if (searchParams.has('qr')) return 'qr';
  return 'other';
}

// Link previews and crawlers open the address without a person behind it: they are redirected
// like everyone else but never counted as a scan.
const BOT_PATTERN = /bot\b|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|skypeuripreview|slack|discord|linkedin|embedly|pinterest|bingpreview|google-inspectiontool|googleother|lighthouse|headless|monitor|uptime|pingdom|curl\/|wget\/|python-requests|axios\/|node-fetch|go-http-client|okhttp|java\/|libwww|httpclient|vercel-screenshot/i;

export function isBot(userAgent) {
  const ua = String(userAgent || '');
  return !ua || BOT_PATTERN.test(ua);
}

/** Browser prefetches and prerenders open the address before anyone decides to visit it. */
export function isPrefetch(headers) {
  const purpose = `${headers.get('sec-purpose') || ''} ${headers.get('purpose') || ''} ${headers.get('x-purpose') || ''} ${headers.get('x-moz') || ''}`.toLowerCase();
  return purpose.includes('prefetch') || purpose.includes('prerender') || purpose.includes('preview');
}

export function clientIp(headers) {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return headers.get('x-real-ip') || '';
}

/**
 * Opaque fingerprint used only to ignore an immediate second tap from the same phone.
 * A hash of IP + user agent, scoped to one plate and one day: the IP address itself is never
 * sent to the database, and the fingerprint cannot follow a device across plates or days.
 * The database hashes it again with its own private salt before storing it, and erases it
 * after two days. SCAN_HASH_SECRET (optional) adds a second, server-side key.
 * Returns null when the client address is unknown (then the scan is simply not de-duplicated).
 */
export function deviceHash({ ip, userAgent, code, day, secret }) {
  if (!ip) return null;
  const input = `${String(code).toUpperCase()}|${day}|${ip}|${userAgent || ''}`;
  const hash = secret ? createHmac('sha256', secret) : createHash('sha256');
  return hash.update(input).digest('hex').slice(0, 32);
}
