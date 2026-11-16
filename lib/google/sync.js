// Import of Google reviews for linked listings. Three callers, one code path:
//   - a Pub/Sub alert from Google (new or updated review): /api/google/notifications
//   - the daily safety-net job: /api/cron/daily
//   - the owner pressing "Refresh now" or linking a listing
// Reviews are only read here. Replies are published elsewhere, after the owner's approval.
import { googleConfig } from '../env';
import { decryptToken, encryptToken } from './crypto';
import { refreshAccessToken } from './oauth';
import { listReviews } from './api';
import { sendReviewAlert } from '../email/reviews';

const FULL_SYNC_PAGES = 40; // 2,000 reviews
const ALERT_WINDOW_MS = 3 * 86400000;

/**
 * A valid access token for a connection row (or a google_sync_targets entry), or null.
 * A connection that Google has revoked is marked as such so the owner is asked to reconnect.
 */
export async function accessTokenFor(admin, connection, { fetchImpl = fetch } = {}) {
  const key = googleConfig().tokenKey;
  const id = connection.connection_id || connection.id;
  if (connection.access_token_enc && Date.parse(connection.access_token_expires_at || '') > Date.now() + 120000) {
    try {
      return decryptToken(connection.access_token_enc, key);
    } catch {
      // fall through to a refresh
    }
  }
  let refreshToken;
  try {
    refreshToken = decryptToken(connection.refresh_token_enc, key);
  } catch {
    await admin.from('google_connections').update({ status: 'revoked', last_error: 'The stored Google access could not be read. Connect Google again.' }).eq('id', id);
    return null;
  }
  try {
    const fresh = await refreshAccessToken(refreshToken, { fetchImpl });
    await admin.from('google_connections')
      .update({ access_token_enc: encryptToken(fresh.accessToken, key), access_token_expires_at: fresh.expiresAt, last_error: null })
      .eq('id', id);
    return fresh.accessToken;
  } catch (error) {
    if (error.code === 'invalid_grant') {
      await admin.from('google_connections').update({ status: 'revoked', last_error: 'Google access was withdrawn. Connect Google again.' }).eq('id', id);
    } else {
      await admin.from('google_connections').update({ last_error: 'Google did not answer. We will try again.' }).eq('id', id);
    }
    return null;
  }
}

/** Reads the reviews of one linked listing and stores them. Returns { imported, fresh } or { error }. */
export async function syncLocation(admin, token, location, { full = false, fetchImpl = fetch } = {}) {
  const reviews = [];
  let average = null;
  let total = null;
  let pageToken = '';
  let complete = false;
  try {
    for (let page = 0; page < (full ? FULL_SYNC_PAGES : 1); page += 1) {
      const result = await listReviews(token, location.account_name, location.location_name, { pageToken, fetchImpl });
      reviews.push(...result.reviews);
      average = result.averageRating ?? average;
      total = result.totalReviewCount ?? total;
      pageToken = result.nextPageToken;
      if (!pageToken) {
        complete = true;
        break;
      }
    }
  } catch (error) {
    const message = error?.status === 403 || error?.status === 404
      ? 'Google refused access to this listing. Check that this Google account still manages it.'
      : 'Google did not answer. We will try again.';
    await admin.from('google_locations').update({ sync_error: message }).eq('business_id', location.business_id);
    return { error: message };
  }
  const { data, error } = await admin.rpc('google_upsert_reviews', {
    p_business_id: location.business_id, p_reviews: reviews, p_complete: full && complete, p_average: average, p_total: total,
  });
  if (error) return { error: error.message };
  return { imported: reviews.length, fresh: Array.isArray(data) ? data : [] };
}

async function alertFor(admin, target, location, fresh) {
  if (!target.email_review_alerts) return;
  const recent = fresh.filter((r) => r.create_time && Date.now() - Date.parse(r.create_time) < ALERT_WINDOW_MS);
  if (!recent.length) return;
  await sendReviewAlert(admin, {
    companyId: target.company_id, to: target.owner_email, businessId: location.business_id, businessName: location.business_name, reviews: recent,
  }).catch(() => {});
}

/**
 * Refreshes the linked Pro locations of one customer (or one location of that customer).
 * alert: send the new-review email for reviews discovered now (off for the first import).
 */
export async function syncCompany(admin, companyId, { businessId = null, full = false, alert = true, deadline = Infinity, fetchImpl = fetch } = {}) {
  const out = { locations: 0, imported: 0, fresh: 0, errors: 0 };
  const { data: targets, error } = await admin.rpc('google_sync_targets', { p_company_id: companyId });
  if (error) return { ...out, error: error.message };
  for (const target of targets || []) {
    const locations = (target.locations || []).filter((l) => !businessId || l.business_id === businessId);
    if (!locations.length) continue;
    const token = await accessTokenFor(admin, target, { fetchImpl });
    if (!token) {
      out.errors += 1;
      continue;
    }
    for (const location of locations) {
      if (Date.now() > deadline) return { ...out, stopped: true };
      const first = !location.last_synced_at;
      const result = await syncLocation(admin, token, location, { full: full || first, fetchImpl });
      out.locations += 1;
      if (result.error) {
        out.errors += 1;
        continue;
      }
      out.imported += result.imported;
      out.fresh += result.fresh.length;
      if (alert && !first) await alertFor(admin, target, location, result.fresh);
    }
  }
  return out;
}

/** Daily safety net: every active connection, then the retention clean-up. */
export async function syncAllConnections(admin, { deadline = Infinity, fetchImpl = fetch } = {}) {
  const out = await syncCompany(admin, null, { deadline, fetchImpl });
  const maintenance = await admin.rpc('google_maintenance');
  return { ...out, maintenance: maintenance.error ? { error: maintenance.error.message } : maintenance.data };
}

/** A Pub/Sub alert names a listing: refresh the location linked to it, if any. */
export async function handleReviewNotification(admin, { accountName, locationName }, { fetchImpl = fetch } = {}) {
  const { data: link } = await admin.from('google_locations').select('business_id,connection_id')
    .eq('account_name', accountName).eq('location_name', locationName).maybeSingle();
  if (!link) return { matched: false };
  const { data: connection } = await admin.from('google_connections').select('company_id').eq('id', link.connection_id).maybeSingle();
  if (!connection) return { matched: false };
  const result = await syncCompany(admin, connection.company_id, { businessId: link.business_id, fetchImpl });
  return { matched: true, ...result };
}

/** The connection row of a customer (with encrypted tokens), server side only. */
export async function loadConnection(admin, companyId) {
  const { data } = await admin.from('google_connections').select('*').eq('company_id', companyId).maybeSingle();
  return data || null;
}
