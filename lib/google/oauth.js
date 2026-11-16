// Google OAuth 2.0 for web server applications. One scope only: business.manage.
// ReviewLah never sees a Google password: the owner signs in on Google's own page and Google
// hands back a token that the owner can revoke at any time (here, or in their Google account).
import { googleConfig } from '../env.js';

export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/business.manage';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

export function oauthConfigured() {
  const c = googleConfig();
  return Boolean(c.clientId && c.clientSecret && c.tokenKey);
}

export function authorizationUrl(state) {
  const c = googleConfig();
  const params = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: c.redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPE,
    access_type: 'offline', // a refresh token, so reviews can be read while the owner is away
    prompt: 'consent',
    include_granted_scopes: 'false',
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function tokenRequest(params, fetchImpl) {
  const c = googleConfig();
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, ...params }).toString(),
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`Google token endpoint answered ${response.status}: ${body.error || 'error'}`);
    error.code = body.error || 'token_error';
    throw error;
  }
  return body;
}

/** Authorization code -> { accessToken, refreshToken, expiresAt, scope }. */
export async function exchangeCode(code, { fetchImpl = fetch } = {}) {
  const body = await tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: googleConfig().redirectUri }, fetchImpl);
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token || null,
    expiresAt: new Date(Date.now() + (Number(body.expires_in) || 3600) * 1000).toISOString(),
    scope: body.scope || '',
  };
}

/** Refresh token -> { accessToken, expiresAt }. Throws with code 'invalid_grant' once access was revoked. */
export async function refreshAccessToken(refreshToken, { fetchImpl = fetch } = {}) {
  const body = await tokenRequest({ refresh_token: refreshToken, grant_type: 'refresh_token' }, fetchImpl);
  return { accessToken: body.access_token, expiresAt: new Date(Date.now() + (Number(body.expires_in) || 3600) * 1000).toISOString() };
}

/** Revokes the grant at Google (best effort: the local data is deleted either way). */
export async function revokeToken(token, { fetchImpl = fetch } = {}) {
  try {
    const response = await fetchImpl(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function hasRequiredScope(scope) {
  return String(scope || '').split(/\s+/).includes(GOOGLE_SCOPE);
}
