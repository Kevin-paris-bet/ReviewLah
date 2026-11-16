// The checks run by scripts/app-smoke.mjs. One block per area of the app.
import { createHmac } from 'node:crypto';

export default async function checks({ page, get, check, supabase, owner, other, newcomer, admin, bangsar, ttdi, salon, BASE, env }) {
  // Visitors
  let r = await get('/dashboard');
  check('a visitor is sent to the login page', r.status === 307 && r.location === '/login', `${r.status} ${r.location}`);
  await page('login page', '/login', null, ['Send me a login link']);

  // Basic dashboard
  await page('overview: owner sees both locations', '/dashboard', owner,
    ['Your business, at a glance.', 'Kopi Corner Bangsar', 'Kopi Corner TTDI', 'It does not prove that a review was posted'], ['Salon Seri']);
  await page('overview: second customer sees only their location', '/dashboard', other, ['Salon Seri Mont Kiara'], ['Kopi Corner']);
  await page('overview: a login with no plate gets a clear explanation', '/dashboard', newcomer, ['No plate is linked to this email yet']);
  await page('location page', `/dashboard/locations/${bangsar.business_id}`, owner, ['Google review link', 'Change the link', 'Counter', 'go.reviewlah.my']);
  r = await get(`/dashboard/locations/${bangsar.business_id}`, other);
  check('another customer cannot open my location', r.status === 404, `status ${r.status}`);
  await page('account page', '/dashboard/account', owner, ['Aisha Rahman', 'Login email', 'aisha@kopicorner.my']);
  await page('help page', '/dashboard/help', owner, ['Contact support', 'What exactly is a scan?', 'WhatsApp us']);

  // Pro dashboard
  await page('analytics: 30 days by day', `/dashboard/analytics?location=${bangsar.business_id}`, owner,
    ['Scans per day', 'NFC taps and QR scans', 'Busiest hours', 'Busiest days of the week', 'By plate', 'Export CSV', 'View as table']);
  await page('analytics: 90 days by week', `/dashboard/analytics?location=${bangsar.business_id}&days=90`, owner, ['Scans per week']);
  await page('analytics: by month', `/dashboard/analytics?location=${bangsar.business_id}&days=7&by=month`, owner, ['Scans per month, last 12 months']);
  await page('analytics: one plate', `/dashboard/analytics?location=${bangsar.business_id}&plate=${bangsar.plates[1].id}`, owner, ['Table 4']);
  await page('analytics: a Basic location shows the total and what Pro adds, no figures', `/dashboard/analytics?location=${ttdi.business_id}`, owner,
    ['Total scans, all time', 'OPTIONAL PRO'], ['Busiest hours']);
  await page('analytics: Basic customer', '/dashboard/analytics', other, ['OPTIONAL PRO'], ['Busiest hours']);
  await page('compare', '/dashboard/compare?days=30', owner, ['Locations', 'Plates', 'Kopi Corner Bangsar', 'Add Pro to compare', 'Terrace']);
  await page('compare: Basic customer', '/dashboard/compare', other, ['OPTIONAL PRO']);
  await page('links editor', `/dashboard/links?location=${bangsar.business_id}`, owner, ['Your page address', 'Save links page', '/l/kopi-corner-bangsar-']);
  await page('links: Basic location', `/dashboard/links?location=${ttdi.business_id}`, owner, ['OPTIONAL PRO'], ['Save links page']);

  const slugOf = async (id) => (await supabase.db.query('select slug from public.businesses where id = $1', [id])).rows[0].slug;
  const proSlug = await slugOf(bangsar.business_id);
  const basicSlug = await slugOf(ttdi.business_id);
  await page('public links page (Pro): review button first, then the links', `/l/${proSlug}`, null,
    ['Review us on Google', 'View our menu', 'Chat on WhatsApp', 'https://search.google.com/local/writereview?placeid=ChIJDEMO0001']);
  await page('public links page (Basic): review button only', `/l/${basicSlug}`, null, ['Review us on Google'], ['View our menu']);
  let r2 = await get('/l/does-not-exist');
  check('unknown links page is a 404', r2.status === 404, `status ${r2.status}`);

  r2 = await get(`/dashboard/export?location=${bangsar.business_id}&days=7`, owner);
  const lines = r2.text.trim().split('\r\n');
  check('CSV export downloads with a header and one line per scan',
    r2.status === 200 && r2.type.startsWith('text/csv') && r2.disposition.includes('reviewlah-scans-kopi-corner-bangsar-') && lines[0].includes('Date (Malaysia time)') && lines.length > 20,
    `${r2.status} ${r2.type} ${lines.length} lines`);
  check('CSV rows carry Malaysia-time timestamps and readable sources', /\+08:00$/.test(lines[1] || '') && /NFC tap|QR scan|Direct link/.test(lines[1] || ''), lines[1]);
  r2 = await get(`/dashboard/export?location=${ttdi.business_id}&days=7`, owner);
  check('CSV export of a Basic location is refused (sent to the plan page)', r2.status === 307 && r2.location.includes('/dashboard/billing'), `${r2.status} ${r2.location}`);
  r2 = await get(`/dashboard/export?location=${bangsar.business_id}&days=7`, other);
  check('CSV export of someone else\'s location is refused', r2.status === 404, `status ${r2.status}`);
  r2 = await get(`/dashboard/export?location=${bangsar.business_id}&days=7`);
  check('CSV export without login is refused', r2.status === 307 && r2.location.endsWith('/login'), `${r2.status} ${r2.location}`);

  // Plan and payments
  await page('plan page: Pro location and Basic location with both prices', '/dashboard/billing', owner,
    ['Plan and payments', 'What Pro adds', 'switched on for you by the ReviewLah team', 'Get Pro yearly', 'Get Pro monthly', 'RM290', 'RM29', 'your plate and your Basic dashboard keep working']);
  await page('plan page: Basic customer', '/dashboard/billing', other, ['Get Pro yearly', 'No payment yet']);
  await page('plan page: login with no plate', '/dashboard/billing', newcomer, ['No plate is linked to this email yet'], ['Get Pro']);

  const webhook = async (event, { secret = env.AIRWALLEX_WEBHOOK_SECRET, timestamp = String(Date.now()) } = {}) => {
    const body = JSON.stringify(event);
    const signature = createHmac('sha256', secret).update(`${timestamp}${body}`).digest('hex');
    const response = await fetch(`${BASE}/api/webhooks/airwallex`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-timestamp': timestamp, 'x-signature': signature }, body });
    return { status: response.status, json: await response.json().catch(() => ({})) };
  };
  const isPro = async (id) => (await supabase.db.query('select public.business_is_pro($1) as pro', [id])).rows[0].pro;
  const subEvent = (id, name, status, extra = {}) => ({
    id, name, created_at: new Date().toISOString(),
    data: { object: { id: 'sub_smoke_1', status, billing_customer_id: 'bcus_smoke', recurring: { period: 1, period_unit: 'YEAR' },
      current_period_starts_at: new Date().toISOString(), current_period_ends_at: new Date(Date.now() + 365 * 86400000).toISOString(),
      cancel_at_period_end: false, metadata: { business_id: ttdi.business_id }, ...extra } },
  });
  let w = await webhook(subEvent('evt_smoke_bad', 'subscription.active', 'ACTIVE'), { secret: 'wrong-secret' });
  check('webhook with a wrong signature is refused and changes nothing', w.status === 401 && !(await isPro(ttdi.business_id)), `status ${w.status}`);
  w = await webhook(subEvent('evt_smoke_old', 'subscription.active', 'ACTIVE'), { timestamp: String(Date.now() - 3600000) });
  check('webhook replayed an hour later is refused', w.status === 401, `status ${w.status}`);
  w = await fetch(`${BASE}/api/webhooks/unknown`, { method: 'POST', body: '{}' });
  check('webhook for an unknown provider is a 404', w.status === 404, `status ${w.status}`);
  w = await webhook(subEvent('evt_smoke_1', 'subscription.active', 'ACTIVE'));
  check('signed webhook activates Pro for that location', w.status === 200 && w.json.outcome === 'applied' && (await isPro(ttdi.business_id)), `${w.status} ${JSON.stringify(w.json)}`);
  w = await webhook(subEvent('evt_smoke_1', 'subscription.active', 'ACTIVE'));
  check('the same webhook delivered twice is applied once', w.status === 200 && w.json.outcome === 'duplicate', `${w.status} ${JSON.stringify(w.json)}`);
  w = await webhook({ id: 'evt_smoke_inv', name: 'invoice.paid', created_at: new Date().toISOString(),
    data: { object: { id: 'inv_smoke_1', number: 'INV-0001', status: 'FINALIZED', payment_status: 'PAID', subscription_id: 'sub_smoke_1', currency: 'MYR', total_amount: 290, paid_at: new Date().toISOString(), hosted_url: 'https://example.com/invoice/inv_smoke_1' } } });
  check('invoice webhook records the payment', w.status === 200 && w.json.outcome === 'applied', `${w.status} ${JSON.stringify(w.json)}`);
  await page('plan page after payment: renewal date, cancel button, payment line', '/dashboard/billing', owner,
    ['RM290 / year', 'Renews on', 'Cancel renewal', 'RM290', 'PAID', 'https://example.com/invoice/inv_smoke_1']);
  await page('analytics unlocked for the newly paid location', `/dashboard/analytics?location=${ttdi.business_id}`, owner, ['Busiest hours']);
  r = await get('/dashboard/billing', other);
  check('another customer does not see these payments', r.status === 200 && !r.text.includes('inv_smoke_1'), `status ${r.status}`);
  w = await webhook(subEvent('evt_smoke_2', 'subscription.cancelled', 'CANCELLED'));
  check('cancellation webhook ends Pro; the plate still redirects', w.status === 200 && !(await isPro(ttdi.business_id)), `${w.status} ${JSON.stringify(w.json)}`);
  r = await get(`/go/${ttdi.plates[0].code}?nfc`, null, { headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1', 'x-forwarded-for': '203.0.113.9' } });
  check('plate of a location whose Pro ended still opens the Google review page', r.status === 302 && r.location === 'https://g.page/r/DEMO-TTDI/review', `${r.status} ${r.location}`);

  // Admin
  await page('admin overview with the all-in-one form', '/admin', admin, ['Overview', 'New customer, location and plates', 'Create customer, location and plates', 'Pro locations']);
  r = await get('/admin', owner);
  check('a customer cannot open the admin', r.status === 307 && r.location.includes('/dashboard'), `${r.status} ${r.location}`);
  r = await get('/admin/customers', null);
  check('a visitor is sent to the login page from the admin', r.status === 307 && r.location.includes('/login'), `${r.status} ${r.location}`);
  await page('admin customers', '/admin/customers', admin, ['Kopi Corner Sdn Bhd', 'Salon Seri', 'aisha@kopicorner.my']);
  await page('admin customers search', '/admin/customers?q=salon', admin, ['Salon Seri'], ['Kopi Corner Sdn Bhd']);
  await page('admin customer page', `/admin/customers/${bangsar.company_id}`, admin,
    ['Kopi Corner Bangsar', 'Kopi Corner TTDI', 'Manual Pro', 'Add a location', 'Customer details', 'go.reviewlah.my', 'Switch Pro off', 'History']);
  await page('admin customer page shows the addresses of new plates', `/admin/customers/${bangsar.company_id}?ok=created&new=${bangsar.plates[0].code}`, admin,
    ['program these addresses', `https://go.reviewlah.my/${bangsar.plates[0].code}?nfc`, `https://go.reviewlah.my/${bangsar.plates[0].code}?qr`]);
  r = await get(`/admin/customers/${bangsar.company_id}`, owner);
  check('a customer cannot open an admin customer page', r.status === 307, `status ${r.status}`);
  await page('admin plates', '/admin/plates', admin, ['Address in the chip', bangsar.plates[0].code, 'Salon Seri Mont Kiara']);
  await page('admin plans', '/admin/subscriptions', admin, ['Plans', 'Manual', 'Kopi Corner Bangsar']);
  await page('admin support', '/admin/support', admin, ['My plate opens the page on Android', 'Mark as done', 'ben@salonseri.my']);
  await page('admin system', '/admin/system', admin, ['SUPABASE_SECRET_KEY', 'AIRWALLEX_WEBHOOK_SECRET', '/api/webhooks/airwallex', 'Latest payment events', 'subscription.active'], ['dev-webhook-secret', 'dev-service']);

  // Scheduled job
  let c = await fetch(`${BASE}/api/cron/daily`);
  check('the daily job refuses a call without the secret', c.status === 401, `status ${c.status}`);
  c = await fetch(`${BASE}/api/cron/daily`, { headers: { authorization: `Bearer ${env.CRON_SECRET}` } });
  const cron = await c.json().catch(() => ({}));
  check('the daily job runs with the secret', c.status === 200 && cron.ok === true && cron.maintenance && !cron.maintenance.error, `${c.status} ${JSON.stringify(cron)}`);

  // Google features are off by default
  r = await get('/dashboard/reviews', owner);
  check('Reviews page does not exist while GBP_ENABLED is off', r.status === 404, `status ${r.status}`);
  r = await get('/dashboard/google', owner);
  check('Google connection page does not exist while GBP_ENABLED is off', r.status === 404, `status ${r.status}`);
  let g = await fetch(`${BASE}/api/google/notifications`, { method: 'POST', body: '{}' });
  check('Pub/Sub endpoint is closed while GBP_ENABLED is off', g.status === 404, `status ${g.status}`);
  g = await fetch(`${BASE}/api/google/callback?code=x&state=y`, { redirect: 'manual' });
  check('OAuth callback is closed while GBP_ENABLED is off', g.status === 404, `status ${g.status}`);
  await page('overview has no Reviews tab while GBP_ENABLED is off', '/dashboard', owner, ['Analytics'], ['/dashboard/reviews']);

  // Legal pages (public)
  await page('privacy policy', '/privacy', null, ['Privacy policy', 'https://www.googleapis.com/auth/business.manage', 'Limited Use', 'Personal Data Protection Act 2010', 'Disconnect Google and delete data', 'does not use it to train its models']);
  await page('terms of service', '/terms', null, ['Terms of service', 'Scans are not reviews', 'review gating', 'Your plate and your Basic dashboard keep working']);
}

// Run against the same app restarted with GBP_ENABLED=true.
export async function google({ page, get, check, supabase, owner, other, bangsar, ttdi, BASE }) {
  await page('overview shows the Reviews tab', '/dashboard', owner, ['/dashboard/reviews']);
  await page('Google connection page: connected, linked listing, delete button', '/dashboard/google', owner,
    ['Google is connected', 'Aisha Rahman', 'Kopi Corner Bangsar', 'Jalan Telawi 3', 'Refresh now', 'Disconnect Google and delete data', 'Reviews and reply drafts are part of Pro'], ['v1.demo']);
  await page('Google connection page: not connected yet', '/dashboard/google', other,
    ['Connect your Google Business Profile', 'never sees your Google password', 'Connect Google', 'Nothing is ever posted automatically']);
  await page('reviews inbox', `/dashboard/reviews?location=${bangsar.business_id}`, owner,
    ['Mei Ling Tan', 'Waited 40 minutes', 'Average rating', 'Approve and publish on Google', 'Save draft', 'written by AI in English', 'We are sorry about the wait on Saturday', 'Bahasa Malaysia', '中文', 'Your reply', 'Terima kasih Siti!', 'Rating only, no text']);
  await page('reviews inbox: to reply only', `/dashboard/reviews?location=${bangsar.business_id}&filter=unreplied`, owner, ['Mei Ling Tan', 'Farid Hakim'], ['Daniel Wong']);
  await page('reviews for a Basic location show the Pro screen', `/dashboard/reviews?location=${ttdi.business_id}`, owner, ['See new Google reviews and reply faster'], ['Mei Ling Tan']);
  await page('another customer sees none of these reviews', '/dashboard/reviews', other, [], ['Mei Ling Tan', 'Farid Hakim']);
  const before = (await supabase.db.query('select count(*)::int as n from public.google_reviews where reply_comment is not null')).rows[0].n;
  check('opening the pages published nothing: replies unchanged, draft still a draft', before === 2
    && (await supabase.db.query('select count(*)::int as n from public.review_reply_drafts')).rows[0].n === 1, `replies ${before}`);

  let g = await fetch(`${BASE}/api/google/notifications`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: { data: 'e30=' } }) });
  check('Pub/Sub push without a Google token is refused', g.status === 401, `status ${g.status}`);
  g = await fetch(`${BASE}/api/google/notifications`, { method: 'POST', headers: { authorization: 'Bearer aaa.bbb.ccc' }, body: '{}' });
  check('Pub/Sub push with a forged token is refused', g.status === 401, `status ${g.status}`);
  let r = await get('/api/google/callback?code=abc&state=forged', owner);
  check('OAuth return with a forged state is refused', r.status === 307 && r.location.includes('error=google_state'), `${r.status} ${r.location}`);
  r = await get('/api/google/callback?code=abc&state=x', null);
  check('OAuth return without a session goes to the login page', r.status === 307 && r.location.includes('/login'), `${r.status} ${r.location}`);
}
