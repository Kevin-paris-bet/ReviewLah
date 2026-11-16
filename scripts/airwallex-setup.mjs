// One-off helper: creates the "ReviewLah Pro" product and its two prices (RM29 / month and
// RM290 / year) in your Airwallex account, then prints the two price ids to add in Vercel.
//
//   AIRWALLEX_CLIENT_ID=... AIRWALLEX_API_KEY=... node scripts/airwallex-setup.mjs            (production)
//   AIRWALLEX_ENV=sandbox AIRWALLEX_CLIENT_ID=... AIRWALLEX_API_KEY=... node scripts/airwallex-setup.mjs
//
// The keys are read from the environment of this command only: they are never written anywhere.
// You can also create the product and prices by hand in the Airwallex web app (Products & Prices).
import { randomUUID } from 'node:crypto';

const sandbox = (process.env.AIRWALLEX_ENV || '').toLowerCase() === 'sandbox';
const base = (process.env.AIRWALLEX_API_URL || (sandbox ? 'https://api.sandbox.airwallex.com' : 'https://api.airwallex.com')).replace(/\/+$/, '');
const { AIRWALLEX_CLIENT_ID: clientId, AIRWALLEX_API_KEY: apiKey } = process.env;
if (!clientId || !apiKey) {
  console.error('Set AIRWALLEX_CLIENT_ID and AIRWALLEX_API_KEY for this command.');
  process.exit(1);
}

async function post(path, body, token) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: token
      ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
      : { 'x-client-id': clientId, 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} answered ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

const { token } = await post('/api/v1/authentication/login');
const product = await post('/api/v1/billing/products/create', {
  request_id: randomUUID(), name: 'ReviewLah Pro', description: 'Optional Pro dashboard for one location (ReviewLah.my).',
}, token);
const price = (amount, unit) => post('/api/v1/billing/prices/create', {
  request_id: randomUUID(), product_id: product.id, currency: 'MYR', pricing_model: 'FLAT', flat_amount: amount,
  recurring: { period: 1, period_unit: unit },
}, token);
const monthly = await price(29, 'MONTH');
const yearly = await price(290, 'YEAR');

console.log(`\nCreated in Airwallex (${sandbox ? 'sandbox' : 'production'}). Add these to Vercel > Environment Variables:\n`);
console.log(`AIRWALLEX_PRICE_MONTHLY=${monthly.id}`);
console.log(`AIRWALLEX_PRICE_YEARLY=${yearly.id}`);
