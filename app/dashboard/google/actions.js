'use server';
// Google Business Profile connection, as the business owner. Every action re-checks ownership
// with the owner's own session before the server (service role) touches tokens or Google.
import { randomBytes } from 'node:crypto';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { gbpEnabled, googleConfig } from '../../../lib/env';
import { adminClient } from '../../../lib/supabase/admin';
import { errorCode } from '../../../lib/dashboard';
import { isUuid } from '../../../lib/validation';
import { session, go, text } from '../../../lib/action-helpers';
import { authorizationUrl, oauthConfigured, revokeToken } from '../../../lib/google/oauth';
import { listLocations } from '../../../lib/google/api';
import { decryptToken } from '../../../lib/google/crypto';
import { accessTokenFor, loadConnection, syncCompany } from '../../../lib/google/sync';

const BACK = '/dashboard/google';
const STATE_COOKIE = 'rl_google_state';

function ready() {
  if (!gbpEnabled()) redirect('/dashboard');
  const admin = adminClient();
  if (!oauthConfigured() || !admin) go(BACK, 'error', 'config');
  return admin;
}

async function ownedBusiness(supabase, businessId) {
  if (!isUuid(businessId)) go(BACK, 'error', 'not_found');
  const { data } = await supabase.from('businesses').select('id,company_id,name').eq('id', businessId).maybeSingle();
  const { data: owns } = await supabase.rpc('owns_business', { p_business_id: businessId });
  if (!data || owns !== true) go(BACK, 'error', 'not_allowed');
  return data;
}

// Sends the owner to Google's own sign-in and consent page (scope: business.manage only).
export async function connectGoogle(formData) {
  const { supabase } = await session();
  ready();
  const companyId = text(formData, 'company_id', 40);
  if (!isUuid(companyId)) go(BACK, 'error', 'not_found');
  const { data: owns } = await supabase.rpc('owns_company', { p_company_id: companyId });
  if (owns !== true) go(BACK, 'error', 'not_allowed');
  const state = randomBytes(24).toString('base64url');
  (await cookies()).set(STATE_COOKIE, `${state}.${companyId}`, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 600,
  });
  redirect(authorizationUrl(state));
}

// Links one Google listing to one location, then imports its reviews. The listing is looked up
// again at Google with the owner's connection: an id sent by the browser is never trusted.
export async function linkListing(formData) {
  const { supabase } = await session();
  const admin = ready();
  const business = await ownedBusiness(supabase, text(formData, 'business_id', 40));
  const { data: pro } = await supabase.rpc('business_is_pro', { p_business_id: business.id });
  if (pro !== true) go(BACK, 'error', 'pro_required');
  const [accountName, locationName] = text(formData, 'listing', 200).split('|');
  const connection = await loadConnection(admin, business.company_id);
  const token = connection && connection.status === 'active' ? await accessTokenFor(admin, connection) : null;
  if (!token) go(BACK, 'error', 'google_failed');
  let listing;
  try {
    listing = (await listLocations(token, accountName || '')).find((l) => l.locationName === locationName);
  } catch {
    go(BACK, 'error', 'google_failed');
  }
  if (!listing) go(BACK, 'error', 'not_found');
  const { error } = await admin.rpc('google_link_location', {
    p_business_id: business.id, p_account_name: listing.accountName, p_location_name: listing.locationName,
    p_title: listing.title, p_address: listing.address, p_place_id: listing.placeId,
  });
  if (error) go(BACK, 'error', errorCode(error));
  await syncCompany(admin, business.company_id, { businessId: business.id, full: true, alert: false, deadline: Date.now() + 20000 }).catch(() => {});
  revalidatePath('/dashboard', 'layout');
  go(BACK, 'ok', 'linked');
}

export async function unlinkListing(formData) {
  const { supabase } = await session();
  if (!gbpEnabled()) redirect('/dashboard');
  const business = await ownedBusiness(supabase, text(formData, 'business_id', 40));
  const { error } = await supabase.rpc('google_unlink_location', { p_business_id: business.id });
  if (error) go(BACK, 'error', errorCode(error));
  revalidatePath('/dashboard', 'layout');
  go(BACK, 'ok', 'unlinked');
}

export async function refreshReviews(formData) {
  const { supabase } = await session();
  const admin = ready();
  const business = await ownedBusiness(supabase, text(formData, 'business_id', 40));
  const back = text(formData, 'back', 20) === 'reviews' ? `/dashboard/reviews?location=${business.id}` : BACK;
  const result = await syncCompany(admin, business.company_id, { businessId: business.id, full: true, alert: false, deadline: Date.now() + 25000 });
  revalidatePath('/dashboard', 'layout');
  if (result.error || result.errors > 0 || result.locations === 0) go(back, 'error', 'google_failed');
  go(back, 'ok', 'synced');
}

// "Disconnect Google and delete data": revokes our access at Google, then deletes the stored
// tokens, the linked listings and every imported review and draft of this customer.
export async function disconnectGoogle(formData) {
  const { supabase } = await session();
  if (!gbpEnabled()) redirect('/dashboard');
  const companyId = text(formData, 'company_id', 40);
  if (!isUuid(companyId)) go(BACK, 'error', 'not_found');
  const { data: owns } = await supabase.rpc('owns_company', { p_company_id: companyId });
  if (owns !== true) go(BACK, 'error', 'not_allowed');
  const admin = adminClient();
  if (admin) {
    const connection = await loadConnection(admin, companyId);
    if (connection) {
      try {
        await revokeToken(decryptToken(connection.refresh_token_enc, googleConfig().tokenKey));
      } catch {
        // The local data is deleted in every case; the owner can also remove access in their Google account.
      }
    }
  }
  const { error } = await supabase.rpc('google_delete_data', { p_company_id: companyId });
  if (error) go(BACK, 'error', errorCode(error));
  revalidatePath('/dashboard', 'layout');
  go(BACK, 'ok', 'disconnected');
}
