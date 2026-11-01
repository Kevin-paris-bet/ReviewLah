import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY } from '../../../lib/supabase/config';

export const dynamic = 'force-dynamic';

// go.reviewlah.my/A7X92?nfc   (written on the NFC chip)
// go.reviewlah.my/A7X92?qr    (printed in the QR code)
// Records one scan, then sends the visitor straight to the business's Google review page.
export async function GET(request, { params }) {
  const { code } = await params;
  const url = new URL(request.url);
  const source = url.searchParams.has('nfc') ? 'nfc' : url.searchParams.has('qr') ? 'qr' : 'other';

  let destination = null;
  if (/^[A-Za-z0-9]{3,16}$/.test(code)) {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
    const { data } = await supabase.rpc('record_scan', { p_code: code, p_source: source });
    if (typeof data === 'string' && data.startsWith('https://')) destination = data;
  }

  const target = destination || new URL('/', 'https://www.reviewlah.my').toString();
  const response = NextResponse.redirect(target, 302);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
