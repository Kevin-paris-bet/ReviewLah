// The checks run by scripts/app-smoke.mjs. One block per area of the app.
export default async function checks({ page, get, check, supabase, owner, other, newcomer, admin, bangsar, ttdi, salon }) {
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
}
