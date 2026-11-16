import { NextResponse, after } from 'next/server';
import { SUPABASE_URL, SUPABASE_KEY } from '../../../lib/supabase/config';
import { CODE_PATTERN, scanSource, isBot, isPrefetch, clientIp, deviceHash } from '../../../lib/scan';
import { klDateKey } from '../../../lib/time';
import { scanHashSecret, siteUrl } from '../../../lib/env';

// go.reviewlah.my/A7X92?nfc   (written on the NFC chip)
// go.reviewlah.my/A7X92?qr    (printed in the QR code)
// Records one scan, then sends the visitor straight to the business's Google review page.
// Everyone goes to the same page: there is no rating filter of any kind.
//
// This route must stay fast and must never strand a customer:
//  - one database call, with a short timeout;
//  - if the database does not know the newer function yet (migration not applied), the previous
//    function is used;
//  - if the database does not answer, the last known destination of the plate is used at once
//    (kept in this server instance and in the shared data cache) and the scan is retried after
//    the response. The customer lands on Google either way.

const TIMEOUT_MS = 2000;
const FALLBACK_TTL_SECONDS = 600;
const lastKnown = new Map(); // code -> destination, per warm server instance
const LAST_KNOWN_MAX = 5000;

const HEADERS = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

class UnknownFunction extends Error {}

async function rpc(name, body) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 404) throw new UnknownFunction(name);
  if (!response.ok) throw new Error(`${name} failed with status ${response.status}`);
  return response.json();
}

// Tries each call in order; moves to the next one only when the function (or its signature)
// is unknown to the database, which is what happens before a migration is applied.
async function firstAvailable(calls) {
  let last;
  for (const [name, body] of calls) {
    try {
      return await rpc(name, body);
    } catch (error) {
      if (!(error instanceof UnknownFunction)) throw error;
      last = error;
    }
  }
  throw last || new Error('no scan function available');
}

// The destination of a plate, read through the shared data cache (a GET, so it can be cached).
// When the database is down, the cache keeps answering with the last value it saw.
async function cachedDestination(code) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/plate_destination?p_code=${encodeURIComponent(code)}`, {
    headers: HEADERS,
    next: { revalidate: FALLBACK_TTL_SECONDS, tags: [`plate:${code}`] },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`plate_destination failed with status ${response.status}`);
  return response.json();
}

function isDestination(value) {
  return typeof value === 'string' && value.startsWith('https://');
}

function remember(code, destination) {
  if (lastKnown.size >= LAST_KNOWN_MAX) lastKnown.clear();
  lastKnown.set(code, destination);
}

async function destinationFor(request, rawCode, { count }) {
  const code = String(rawCode || '').toUpperCase();
  if (!CODE_PATTERN.test(code)) return null;

  const url = new URL(request.url);
  const source = scanSource(url.searchParams);
  const legacy = ['record_scan', { p_code: code, p_source: source }];
  let calls;
  if (count) {
    const device = deviceHash({
      ip: clientIp(request.headers),
      userAgent: request.headers.get('user-agent'),
      code,
      day: klDateKey(),
      secret: scanHashSecret(),
    });
    calls = [['record_scan', { p_code: code, p_source: source, p_device: device }], legacy];
  } else {
    calls = [['plate_destination', { p_code: code }], legacy];
  }

  const settle = (data) => {
    if (isDestination(data)) {
      remember(code, data);
      // Keeps the shared fallback warm without delaying the redirect.
      after(() => cachedDestination(code).catch(() => {}));
      return data;
    }
    lastKnown.delete(code); // unknown or paused plate
    return null;
  };

  try {
    return settle(await firstAvailable(calls));
  } catch (error) {
    console.error('[go] database call failed', code, error?.message);
  }

  // The database did not answer. If the destination of this plate is known, redirect now and
  // try to record the scan once more after the response (a double is caught by the de-duplication).
  let known = lastKnown.get(code);
  if (!known) known = await cachedDestination(code).catch(() => null);
  if (isDestination(known)) {
    if (count) after(() => firstAvailable(calls).catch(() => {}));
    return known;
  }
  // Nothing known about this plate yet: one more attempt before giving up.
  try {
    return settle(await firstAvailable(calls));
  } catch (error) {
    console.error('[go] scan not recorded', code, error?.message);
    return null;
  }
}

function redirect(destination) {
  const response = NextResponse.redirect(destination || `${siteUrl()}/`, 302);
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

export async function GET(request, { params }) {
  const { code } = await params;
  // Link previews, crawlers and browser prefetches are redirected but never counted as a scan.
  const count = !isBot(request.headers.get('user-agent')) && !isPrefetch(request.headers);
  return redirect(await destinationFor(request, code, { count }));
}

export async function HEAD(request, { params }) {
  const { code } = await params;
  return redirect(await destinationFor(request, code, { count: false }));
}
