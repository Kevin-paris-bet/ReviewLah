// Data loading shared by the dashboard layout and pages. One database call per request
// (dashboard_bootstrap), de-duplicated with React cache.
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from './supabase/server';

/** PostgREST answer when a function does not exist yet (migration not applied). */
export function isMissingFunction(error) {
  return Boolean(error) && (error.code === 'PGRST202' || error.code === '42883' || /could not find the function/i.test(error.message || ''));
}

export const getSession = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return { supabase, user: data?.user || null };
});

export const loadDashboard = cache(async () => {
  const { supabase, user } = await getSession();
  if (!user) redirect('/login');
  const { data, error } = await supabase.rpc('dashboard_bootstrap');
  if (error) {
    if (isMissingFunction(error)) redirect('/pending');
    throw new Error(`dashboard_bootstrap: ${error.message}`);
  }
  const businesses = data.businesses || [];
  const companies = data.companies || [];
  const plates = businesses.flatMap((b) => b.plates.map((p) => ({ ...p, business_id: b.id, business_name: b.name })));
  return {
    supabase,
    user,
    today: data.today,
    isAdmin: Boolean(data.is_admin),
    companies,
    company: companies[0] || null,
    businesses,
    plates,
    proBusinesses: businesses.filter((b) => b.is_pro),
    totalScans: businesses.reduce((sum, b) => sum + (Number(b.total_scans) || 0), 0),
    lastScanAt: businesses.map((b) => b.last_scan_at).filter(Boolean).sort().at(-1) || null,
  };
});

/** The location matching ?location=…, or the first one (Pro locations first when wantPro). */
export function pickBusiness(data, id, { wantPro = false } = {}) {
  const list = data.businesses;
  if (id) {
    const found = list.find((b) => b.id === id);
    if (found) return found;
  }
  if (wantPro) return data.proBusinesses[0] || list[0] || null;
  return list[0] || null;
}

export function plateName(plate) {
  return plate.label ? `${plate.label} (${plate.code})` : `Plate ${plate.code}`;
}

/** Message code carried by a database error raised by our SQL functions. */
export function errorCode(error, fallback = 'failed') {
  const text = `${error?.message || ''} ${error?.details || ''}`;
  const match = /\b(not_allowed|not_authenticated|pro_required|invalid_review_url|invalid_name|invalid_phone|invalid_links|invalid_message|too_many_requests|invalid_interval|invalid_provider|already_subscribed|not_active|managed_by_support|provider_subscription_exists|not_found|invalid_email|email_in_use|plate_has_scans)\b/.exec(text);
  return match ? match[1] : fallback;
}
