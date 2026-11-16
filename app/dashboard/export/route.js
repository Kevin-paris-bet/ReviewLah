import { NextResponse } from 'next/server';
import { createClient } from '../../../lib/supabase/server';
import { csvRow, safeFilename } from '../../../lib/csv';
import { klDateKey, addDays } from '../../../lib/time';
import { isUuid, isDateKey } from '../../../lib/validation';

export const dynamic = 'force-dynamic';

const PAGE = 2000;
const MAX_ROWS = 500000;
const COLUMNS = [
  ['scan_date', 'Date (Malaysia time)'],
  ['scan_time', 'Time'],
  ['weekday', 'Weekday'],
  ['plate_code', 'Plate code'],
  ['plate_label', 'Plate name'],
  ['source', 'Source'],
  ['scanned_at', 'Timestamp'],
];
const SOURCE_NAMES = { nfc: 'NFC tap', qr: 'QR scan', other: 'Direct link' };

// CSV export of the scans of one Pro location, streamed page by page (never loaded whole in memory).
//   /dashboard/export?location=<id>&days=30          last 7 / 30 / 90 days
//   /dashboard/export?location=<id>&from=2026-10-01&to=2026-10-31
export async function GET(request) {
  const url = new URL(request.url);
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return NextResponse.redirect(new URL('/login', request.url));

  const location = url.searchParams.get('location');
  if (!isUuid(location)) return new NextResponse('Unknown location.', { status: 400 });

  const today = klDateKey();
  let to = today;
  let from;
  if (isDateKey(url.searchParams.get('from')) && isDateKey(url.searchParams.get('to'))) {
    from = url.searchParams.get('from');
    to = url.searchParams.get('to');
    if (from > to) [from, to] = [to, from];
  } else {
    const days = [7, 30, 90, 365].includes(Number(url.searchParams.get('days'))) ? Number(url.searchParams.get('days')) : 30;
    from = addDays(today, -(days - 1));
  }

  const fetchPage = (after) => supabase.rpc('export_scans', { p_business_id: location, p_from: from, p_to: to, p_after: after, p_limit: PAGE });

  // First page before answering, so that access errors become a proper status instead of a broken file.
  const first = await fetchPage(0);
  if (first.error) {
    const message = first.error.message || '';
    if (/pro_required/.test(message)) return NextResponse.redirect(new URL(`/dashboard/billing?location=${location}`, request.url));
    if (/not_allowed/.test(message)) return new NextResponse('Not found.', { status: 404 });
    return new NextResponse('The export could not be prepared. Try again.', { status: 500 });
  }
  const { data: business } = await supabase.from('businesses').select('name').eq('id', location).maybeSingle();

  const encoder = new TextEncoder();
  let rows = first.data || [];
  let sent = 0;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`﻿${csvRow(COLUMNS.map(([, header]) => header))}`));
    },
    async pull(controller) {
      if (!rows.length || sent >= MAX_ROWS) {
        controller.close();
        return;
      }
      let chunk = '';
      for (const row of rows) {
        chunk += csvRow(COLUMNS.map(([key]) => (key === 'source' ? SOURCE_NAMES[row.source] || row.source : row[key])));
      }
      controller.enqueue(encoder.encode(chunk));
      sent += rows.length;
      if (rows.length < PAGE) {
        controller.close();
        return;
      }
      const next = await fetchPage(rows.at(-1).scan_id);
      if (next.error) {
        controller.error(new Error('export interrupted'));
        return;
      }
      rows = next.data || [];
    },
  });

  const name = `reviewlah-scans-${safeFilename(business?.name || 'location')}-${from}-to-${to}.csv`;
  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  });
}
