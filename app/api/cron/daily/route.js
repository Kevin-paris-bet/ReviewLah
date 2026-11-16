import { NextResponse } from 'next/server';
import { adminClient } from '../../../../lib/supabase/admin';
import { cronAuthorized } from '../../../../lib/cron';
import { klParts, previousMonthKey } from '../../../../lib/time';
import { sendMonthlySummaries } from '../../../../lib/email/summaries';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// One scheduled job, every day at 09:00 Malaysia time (vercel.json). It:
//  1. closes subscriptions whose period is over and erases old device fingerprints;
//  2. sends the monthly summary during the first days of the month (each customer once).
// Every step is idempotent, so a retry or a manual run is harmless.
export async function GET(request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const admin = adminClient();
  if (!admin) return NextResponse.json({ error: 'SUPABASE_SECRET_KEY is not configured' }, { status: 503 });

  const started = Date.now();
  const out = {};

  const maintenance = await admin.rpc('maintenance_daily');
  out.maintenance = maintenance.error ? { error: maintenance.error.message } : maintenance.data;

  if (klParts().day <= 5) {
    out.monthly_summary = await sendMonthlySummaries(admin, { month: previousMonthKey(), deadline: started + 30000 });
  }

  return NextResponse.json({ ok: true, ms: Date.now() - started, ...out });
}
