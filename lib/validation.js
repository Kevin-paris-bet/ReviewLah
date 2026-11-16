// Input validation shared by the dashboard, the admin and the tests.
// The review-link rules are mirrored in SQL (public.is_valid_review_url, migration 0003):
// tests/validation.test.js and tests/sql/owner.test.js run the same list against both.

const ANY_PATH_HOSTS = new Set(['g.page', 'maps.app.goo.gl', 'share.google', 'maps.google.com', 'maps.google.com.my']);
const GOOGLE_HOSTS = new Set(['google.com', 'www.google.com', 'google.com.my', 'www.google.com.my']);

/**
 * A plate may only point to a Google review / Google Maps page, over https.
 * Returns { ok: true, url } or { ok: false, error } with a message for the user.
 */
export function validateReviewUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return { ok: false, error: 'Paste your Google review link.' };
  if (raw.length > 600 || /\s/.test(raw)) return { ok: false, error: 'This link is not valid. Copy it again from Google.' };
  const match = /^https:\/\/([A-Za-z0-9.-]+)(\/[^?#]*)?([?#].*)?$/.exec(raw);
  if (!match) {
    return { ok: false, error: raw.startsWith('http://') ? 'The link must start with https://' : 'Paste the full link, starting with https://' };
  }
  const host = match[1].toLowerCase();
  const path = match[2] || '/';
  let allowed = false;
  if (ANY_PATH_HOSTS.has(host)) allowed = true;
  else if (host === 'search.google.com') allowed = /^\/local\//.test(path);
  else if (host === 'goo.gl') allowed = /^\/maps\//.test(path);
  else if (host === 'g.co') allowed = /^\/kgs\//.test(path);
  else if (GOOGLE_HOSTS.has(host)) allowed = /^\/(maps|search|local)(\/|$)/.test(path);
  if (!allowed) {
    return { ok: false, error: 'Use a Google review or Google Maps link (g.page, maps.app.goo.gl, search.google.com/local/writereview, google.com/maps…).' };
  }
  return { ok: true, url: raw };
}

export function isValidReviewUrl(value) {
  return validateReviewUrl(value).ok;
}

export function isValidEmail(value) {
  const email = String(value ?? '').trim();
  return email.length <= 254 && /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(email);
}

export function isValidPhone(value) {
  return /^\+?[0-9 ()-]{6,30}$/.test(String(value ?? '').trim());
}

/** Digits of a phone number in international form. Malaysian local numbers (01x…) get the 60 prefix. */
export function phoneDigits(value) {
  let digits = String(value ?? '').replace(/[^0-9]/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = `60${digits.slice(1)}`;
  return digits;
}

export const LINK_KINDS = [
  { kind: 'menu', name: 'Menu', placeholder: 'https://yourbusiness.com/menu', defaultLabel: 'View our menu' },
  { kind: 'whatsapp', name: 'WhatsApp', placeholder: '+60 12-345 6789', defaultLabel: 'Chat on WhatsApp' },
  { kind: 'booking', name: 'Booking', placeholder: 'https://yourbooking.com/yourbusiness', defaultLabel: 'Book a visit' },
  { kind: 'instagram', name: 'Instagram', placeholder: '@yourbusiness', defaultLabel: 'Follow us on Instagram' },
  { kind: 'facebook', name: 'Facebook', placeholder: 'https://facebook.com/yourbusiness', defaultLabel: 'Find us on Facebook' },
  { kind: 'tiktok', name: 'TikTok', placeholder: '@yourbusiness', defaultLabel: 'Watch us on TikTok' },
  { kind: 'website', name: 'Website', placeholder: 'https://yourbusiness.com', defaultLabel: 'Visit our website' },
  { kind: 'phone', name: 'Phone', placeholder: '+60 3-1234 5678', defaultLabel: 'Call us' },
  { kind: 'email', name: 'Email', placeholder: 'hello@yourbusiness.com', defaultLabel: 'Email us' },
  { kind: 'other', name: 'Other link', placeholder: 'https://', defaultLabel: '' },
];
export const MAX_LINKS = 8;

const KIND_SET = new Set(LINK_KINDS.map((k) => k.kind));
const HANDLE = /^@?([A-Za-z0-9._]{1,40})$/;

function httpsUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw || /\s/.test(raw) || raw.length > 500) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  if (!/^https:\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}([/?#].*)?$/.test(withScheme)) return null;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
  } catch {
    return null;
  }
  return withScheme;
}

/**
 * Turns what the owner typed for one link into a safe URL.
 * WhatsApp and phone accept a number, Instagram and TikTok accept a handle, email an address.
 * Returns { ok: true, link: { kind, label, url } } or { ok: false, error }.
 */
export function normalizeLink(input) {
  const kind = KIND_SET.has(input?.kind) ? input.kind : 'other';
  const meta = LINK_KINDS.find((k) => k.kind === kind);
  const value = String(input?.url ?? '').trim();
  const label = String(input?.label ?? '').trim() || meta.defaultLabel;
  if (!value) return { ok: false, error: `Add a link or number for "${meta.name}", or remove the line.` };
  if (!label) return { ok: false, error: 'Give each link a short button text.' };
  if (label.length > 40) return { ok: false, error: 'Button text is limited to 40 characters.' };

  let url = null;
  if (kind === 'whatsapp') {
    if (/^https:\/\/(wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com)\//i.test(value)) url = httpsUrl(value);
    else {
      const digits = phoneDigits(value);
      if (digits.length >= 8 && digits.length <= 15) url = `https://wa.me/${digits}`;
    }
    if (!url) return { ok: false, error: 'Enter a WhatsApp number with country code, for example +60 12-345 6789.' };
  } else if (kind === 'phone') {
    const digits = phoneDigits(value.replace(/^tel:/i, ''));
    if (digits.length < 6 || digits.length > 15) return { ok: false, error: 'Enter a phone number with country code, for example +60 3-1234 5678.' };
    url = `tel:+${digits}`;
  } else if (kind === 'email') {
    const address = value.replace(/^mailto:/i, '');
    if (!isValidEmail(address)) return { ok: false, error: 'Enter a valid email address.' };
    url = `mailto:${address}`;
  } else if ((kind === 'instagram' || kind === 'tiktok') && HANDLE.test(value)) {
    const handle = HANDLE.exec(value)[1];
    url = kind === 'instagram' ? `https://www.instagram.com/${handle}` : `https://www.tiktok.com/@${handle}`;
  } else {
    url = httpsUrl(value);
    if (!url) return { ok: false, error: `"${value.slice(0, 60)}" is not a valid link. It must start with https://` };
  }
  return { ok: true, link: { kind, label, url } };
}

/** Validates the whole list of a links page. Empty lines are dropped. */
export function normalizeLinks(list) {
  const items = (Array.isArray(list) ? list : []).filter((item) => String(item?.url ?? '').trim() || String(item?.label ?? '').trim());
  if (items.length > MAX_LINKS) return { ok: false, error: `You can add up to ${MAX_LINKS} links.` };
  const links = [];
  for (const item of items) {
    const result = normalizeLink(item);
    if (!result.ok) return result;
    links.push(result.link);
  }
  return { ok: true, links };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value) {
  return UUID.test(String(value ?? ''));
}

export function isDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
