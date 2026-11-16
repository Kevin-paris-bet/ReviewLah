import { NextResponse } from 'next/server';
import { createClient } from '../../../lib/supabase/server';
import { safeNextPath } from '../../../lib/safe-path';

export const dynamic = 'force-dynamic';

const TYPES = new Set(['email', 'magiclink', 'signup', 'invite', 'email_change', 'recovery']);

// Return address of a login link built with a token hash. Unlike /auth/callback it also works when
// the email is opened on another device or in another browser than the one that asked for the link.
// Used when the Supabase email template points to:
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') || 'email';
  const next = safeNextPath(searchParams.get('next'), type === 'email_change' ? '/dashboard/account?ok=account' : '/dashboard');
  if (tokenHash && TYPES.has(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }
  return NextResponse.redirect(`${origin}/login?error=login`);
}
