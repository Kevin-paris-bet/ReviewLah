// Authentication of Pub/Sub push messages (new review alerts).
// The push subscription is configured with an OIDC token: every delivery carries
// "Authorization: Bearer <JWT>" signed by Google. A message is accepted only if the signature is
// Google's, the audience is ours, the token is current and it was issued for the service account
// we configured on the subscription.
import { createPublicKey, verify as verifySignature } from 'node:crypto';

const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
let cache = { keys: null, expiresAt: 0 };

async function googleKeys(fetchImpl) {
  if (cache.keys && cache.expiresAt > Date.now()) return cache.keys;
  const response = await fetchImpl(CERTS_URL, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Google certificates answered ${response.status}`);
  const body = await response.json();
  cache = { keys: body.keys || [], expiresAt: Date.now() + 60 * 60 * 1000 };
  return cache.keys;
}

function decodePart(part) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

/**
 * Returns { ok: true, claims } or { ok: false, reason }.
 * keys: JSON Web Keys to verify against (tests); by default Google's published keys.
 */
export async function verifyPushToken(authorization, { audience, serviceAccount, keys = null, now = Date.now(), fetchImpl = fetch } = {}) {
  const match = /^Bearer\s+([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(authorization || '').trim());
  if (!match) return { ok: false, reason: 'missing token' };
  if (!audience || !serviceAccount) return { ok: false, reason: 'not configured' };
  let header;
  let claims;
  try {
    header = decodePart(match[1]);
    claims = decodePart(match[2]);
  } catch {
    return { ok: false, reason: 'unreadable token' };
  }
  if (header.alg !== 'RS256' || !header.kid) return { ok: false, reason: 'unsupported algorithm' };
  let jwks;
  try {
    jwks = keys || (await googleKeys(fetchImpl));
  } catch {
    return { ok: false, reason: 'certificates unavailable' };
  }
  const jwk = jwks.find((k) => k.kid === header.kid);
  if (!jwk) return { ok: false, reason: 'unknown key' };
  let valid = false;
  try {
    valid = verifySignature('RSA-SHA256', Buffer.from(`${match[1]}.${match[2]}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(match[3], 'base64url'));
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'bad signature' };
  const seconds = Math.floor(now / 1000);
  if (!ISSUERS.has(claims.iss)) return { ok: false, reason: 'wrong issuer' };
  if (claims.aud !== audience) return { ok: false, reason: 'wrong audience' };
  if (typeof claims.exp !== 'number' || claims.exp < seconds - 60) return { ok: false, reason: 'expired' };
  if (typeof claims.iat === 'number' && claims.iat > seconds + 300) return { ok: false, reason: 'issued in the future' };
  if (claims.email !== serviceAccount || claims.email_verified !== true) return { ok: false, reason: 'wrong service account' };
  return { ok: true, claims };
}

/**
 * Body of a push delivery -> the Business Profile notification it carries, or null.
 * { message: { data: base64(JSON), messageId }, subscription }
 * data: { type: 'NEW_REVIEW' | 'UPDATED_REVIEW', review: 'accounts/1/locations/2/reviews/3', location: 'accounts/1/locations/2' }
 */
export function parsePushMessage(body) {
  try {
    const data = JSON.parse(Buffer.from(String(body?.message?.data || ''), 'base64').toString('utf8'));
    const resource = String(data.location || data.review || data.name || '');
    const match = /^(accounts\/[0-9A-Za-z_-]+)\/(locations\/[0-9A-Za-z_-]+)/.exec(resource);
    if (!match) return null;
    return { type: String(data.type || data.notificationType || ''), accountName: match[1], locationName: match[2], messageId: String(body.message.messageId || '') };
  } catch {
    return null;
  }
}
