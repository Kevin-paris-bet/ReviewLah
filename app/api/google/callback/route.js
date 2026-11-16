import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '../../../../lib/supabase/server';
import { adminClient } from '../../../../lib/supabase/admin';
import { gbpEnabled, googleConfig } from '../../../../lib/env';
import { safeEqual } from '../../../../lib/cron';
import { isUuid } from '../../../../lib/validation';
import { exchangeCode, hasRequiredScope, oauthConfigured } from '../../../../lib/google/oauth';
import { listAccounts, enableReviewNotifications } from '../../../../lib/google/api';
import { encryptToken } from '../../../../lib/google/crypto';

export const dynamic = 'force-dynamic';
const STATE_COOKIE = 'rl_google_state';

// Google sends the owner back here after the consent screen.
// The state value must match the one we set before leaving (protection against forged returns),
// the signed-in user must own the company the connection is for, and the refresh token is
// encrypted before it is stored. No Google password ever passes through ReviewLah.
export async function GET(request) {
  if (!gbpEnabled()) return new NextResponse('Not found', { status: 404 });
  const url = new URL(request.url);
  const finish = (kind, code) => {
    const response = NextResponse.redirect(new URL(`/dashboard/google?${kind}=${code}`, request.url));
    response.cookies.delete(STATE_COOKIE);
    return response;
  };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return NextResponse.redirect(new URL('/login?next=/dashboard/google', request.url));
  const admin = adminClient();
  if (!oauthConfigured() || !admin) return finish('error', 'config');

  if (url.searchParams.get('error')) return finish('error', 'google_denied');
  const cookieStore = await cookies();
  const [state, companyId] = String(cookieStore.get(STATE_COOKIE)?.value || '').split('.');
  const code = url.searchParams.get('code');
  if (!code || !state || !isUuid(companyId) || !safeEqual(state, url.searchParams.get('state'))) return finish('error', 'google_state');
  const { data: owns } = await supabase.rpc('owns_company', { p_company_id: companyId });
  if (owns !== true) return finish('error', 'not_allowed');

  let tokens;
  try {
    tokens = await exchangeCode(code);
  } catch (e) {
    console.error('[google] code exchange failed', e?.message);
    return finish('error', 'google_failed');
  }
  if (!hasRequiredScope(tokens.scope)) return finish('error', 'google_denied');
  if (!tokens.refreshToken) return finish('error', 'google_no_refresh');

  const config = googleConfig();
  const accounts = await listAccounts(tokens.accessToken).catch(() => []);
  const label = (accounts.find((a) => a.type === 'PERSONAL') || accounts[0])?.label || 'Google account';
  const saved = await admin.rpc('google_save_connection', {
    p_company_id: companyId, p_user_id: auth.user.id, p_account_label: label,
    p_refresh_token_enc: encryptToken(tokens.refreshToken, config.tokenKey), p_scope: tokens.scope,
  });
  if (saved.error) {
    console.error('[google] connection not saved', saved.error.message);
    return finish('error', 'google_failed');
  }
  await admin.from('google_connections')
    .update({ access_token_enc: encryptToken(tokens.accessToken, config.tokenKey), access_token_expires_at: tokens.expiresAt })
    .eq('id', saved.data);

  // New-review alerts through Pub/Sub (best effort: the daily refresh covers a failure here).
  if (config.pubsubTopic) {
    for (const account of accounts) {
      await enableReviewNotifications(tokens.accessToken, account.name, config.pubsubTopic).catch((e) => console.error('[google] alerts not enabled', account.name, e?.message));
    }
  }
  return finish('ok', 'connected');
}
