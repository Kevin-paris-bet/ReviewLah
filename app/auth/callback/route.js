import { NextResponse } from 'next/server';
import { createClient } from '../../../lib/supabase/server';
import { safeNextPath } from '../../../lib/safe-path';

export const dynamic = 'force-dynamic';

// Return address of the login link when it is opened in the browser that asked for it (PKCE).
export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = safeNextPath(searchParams.get('next'));
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }
  return NextResponse.redirect(`${origin}/login?error=login`);
}
