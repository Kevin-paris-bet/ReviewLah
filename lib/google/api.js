// The few Google Business Profile API calls ReviewLah makes, all with the business.manage scope:
//   - list the accounts and listings the owner manages (to let them choose which one to link);
//   - read the reviews of a linked listing (My Business API v4);
//   - publish, update or delete the business's reply to a review, only after the owner approved it;
//   - ask Google to announce new reviews on our Pub/Sub topic.
const ACCOUNTS = 'https://mybusinessaccountmanagement.googleapis.com/v1';
const INFO = 'https://mybusinessbusinessinformation.googleapis.com/v1';
const V4 = 'https://mybusiness.googleapis.com/v4';
const NOTIFICATIONS = 'https://mybusinessnotifications.googleapis.com/v1';

const STARS = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

export class GoogleApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(token, url, { method = 'GET', body, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 204) return {};
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new GoogleApiError(response.status, data?.error?.message || `Google API answered ${response.status}`);
  return data;
}

const ACCOUNT_NAME = /^accounts\/[0-9A-Za-z_-]+$/;
const LOCATION_NAME = /^locations\/[0-9A-Za-z_-]+$/;
const REVIEW_NAME = /^accounts\/[0-9A-Za-z_-]+\/locations\/[0-9A-Za-z_-]+\/reviews\/[0-9A-Za-z_-]+$/;

function formatAddress(address) {
  if (!address) return '';
  return [...(address.addressLines || []), address.locality, address.postalCode].filter(Boolean).join(', ');
}

/** Every account the signed-in Google user can manage: [{ name: 'accounts/1', label }]. */
export async function listAccounts(token, { fetchImpl = fetch } = {}) {
  const accounts = [];
  let pageToken = '';
  for (let page = 0; page < 10; page += 1) {
    const data = await request(token, `${ACCOUNTS}/accounts?pageSize=20${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`, { fetchImpl });
    for (const a of data.accounts || []) {
      if (ACCOUNT_NAME.test(a.name || '')) accounts.push({ name: a.name, label: a.accountName || a.name, type: a.type || '' });
    }
    pageToken = data.nextPageToken || '';
    if (!pageToken) break;
  }
  return accounts;
}

/** Listings of one account: [{ accountName, locationName, title, address, placeId }]. */
export async function listLocations(token, accountName, { fetchImpl = fetch } = {}) {
  if (!ACCOUNT_NAME.test(accountName)) return [];
  const locations = [];
  let pageToken = '';
  for (let page = 0; page < 10; page += 1) {
    const url = `${INFO}/${accountName}/locations?readMask=name,title,storefrontAddress,metadata&pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const data = await request(token, url, { fetchImpl });
    for (const l of data.locations || []) {
      if (!LOCATION_NAME.test(l.name || '')) continue;
      locations.push({ accountName, locationName: l.name, title: l.title || 'Untitled listing', address: formatAddress(l.storefrontAddress), placeId: l.metadata?.placeId || '' });
    }
    pageToken = data.nextPageToken || '';
    if (!pageToken) break;
  }
  return locations;
}

/** All listings across the owner's accounts. */
export async function listAllLocations(token, options = {}) {
  const accounts = await listAccounts(token, options);
  const all = [];
  for (const account of accounts) {
    const locations = await listLocations(token, account.name, options).catch(() => []);
    for (const location of locations) all.push({ ...location, accountLabel: account.label });
  }
  return { accounts, locations: all };
}

/** A review as returned by the v4 API -> the row we store. */
export function mapReview(review) {
  if (!review?.reviewId || !REVIEW_NAME.test(review.name || '')) return null;
  return {
    review_id: review.reviewId,
    resource_name: review.name,
    reviewer_name: review.reviewer?.isAnonymous ? 'Anonymous' : review.reviewer?.displayName || 'Google user',
    rating: STARS[review.starRating] || null,
    comment: review.comment || null,
    create_time: review.createTime || null,
    update_time: review.updateTime || null,
    reply_comment: review.reviewReply?.comment || null,
    reply_update_time: review.reviewReply?.updateTime || null,
  };
}

/** One page of reviews, most recently updated first. */
export async function listReviews(token, accountName, locationName, { pageToken = '', pageSize = 50, fetchImpl = fetch } = {}) {
  if (!ACCOUNT_NAME.test(accountName) || !LOCATION_NAME.test(locationName)) throw new GoogleApiError(400, 'bad listing name');
  const url = `${V4}/${accountName}/${locationName}/reviews?pageSize=${pageSize}&orderBy=${encodeURIComponent('updateTime desc')}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
  const data = await request(token, url, { fetchImpl });
  return {
    reviews: (data.reviews || []).map(mapReview).filter(Boolean),
    averageRating: typeof data.averageRating === 'number' ? data.averageRating : null,
    totalReviewCount: typeof data.totalReviewCount === 'number' ? data.totalReviewCount : null,
    nextPageToken: data.nextPageToken || '',
  };
}

/** reviews.updateReply — called only after the owner approved the text. */
export async function updateReply(token, reviewName, comment, { fetchImpl = fetch } = {}) {
  if (!REVIEW_NAME.test(reviewName)) throw new GoogleApiError(400, 'bad review name');
  const data = await request(token, `${V4}/${reviewName}/reply`, { method: 'PUT', body: { comment }, fetchImpl });
  return { comment: data.comment || comment, updateTime: data.updateTime || new Date().toISOString() };
}

export async function deleteReply(token, reviewName, { fetchImpl = fetch } = {}) {
  if (!REVIEW_NAME.test(reviewName)) throw new GoogleApiError(400, 'bad review name');
  await request(token, `${V4}/${reviewName}/reply`, { method: 'DELETE', fetchImpl });
}

/** Asks Google to publish NEW_REVIEW / UPDATED_REVIEW messages for this account on our topic. */
export async function enableReviewNotifications(token, accountName, topic, { fetchImpl = fetch } = {}) {
  if (!ACCOUNT_NAME.test(accountName) || !topic) return false;
  await request(token, `${NOTIFICATIONS}/${accountName}/notificationSetting?updateMask=pubsubTopic,notificationTypes`, {
    method: 'PATCH',
    body: { name: `${accountName}/notificationSetting`, pubsubTopic: topic, notificationTypes: ['NEW_REVIEW', 'UPDATED_REVIEW'] },
    fetchImpl,
  });
  return true;
}
