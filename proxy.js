import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { SUPABASE_URL, SUPABASE_KEY } from './lib/supabase/config';

export async function proxy(request) {
  const { pathname } = request.nextUrl;
  const host = (request.headers.get('host') || '').toLowerCase();

  // go.reviewlah.my/CODE  ->  /go/CODE  (the address written on the NFC chip and the QR code)
  if (host.startsWith('go.')) {
    if (pathname === '/' || pathname === '') {
      return NextResponse.redirect('https://www.reviewlah.my/');
    }
    if (!pathname.startsWith('/go/')) {
      const url = request.nextUrl.clone();
      url.pathname = `/go${pathname}`;
      return NextResponse.rewrite(url);
    }
    return NextResponse.next();
  }

  // Keep the login session fresh on the private pages only (never on scans or the marketing site).
  if (!/^\/(dashboard|admin|auth|login)(\/|$)/.test(pathname)) return NextResponse.next();
  let response = NextResponse.next({ request });
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list) {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ['/((?!_next|css/|js/|assets/|favicon).*)'],
};
