// Prices and plan wording. The amounts match the public site (public/js/content.js).
export const CURRENCY = 'MYR';
export const PLATE_PRICE = 99;

export const PRO_PRICES = {
  month: { amount: 29, label: 'RM29 / month', short: 'RM29/month', period: 'month' },
  year: { amount: 290, label: 'RM290 / year', short: 'RM290/year', period: 'year' },
};
export const YEARLY_SAVING = PRO_PRICES.month.amount * 12 - PRO_PRICES.year.amount;

export const BASIC_FEATURES = [
  'Your plate keeps working, with no subscription',
  'Total scan count for every plate',
  'Change your Google review link yourself',
];

export const PRO_FEATURES = [
  'Scans by day, week and month',
  'NFC taps compared with QR scans',
  'Busiest hours and days of the week',
  'Comparison between locations and plates',
  'A links page for your menu, WhatsApp, booking and socials',
  'CSV export and a monthly summary by email',
];

export function formatMoney(cents, currency = CURRENCY) {
  const amount = (Number(cents) || 0) / 100;
  const text = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  return currency === 'MYR' ? `RM${text}` : `${text} ${currency}`;
}

export function isInterval(value) {
  return value === 'month' || value === 'year';
}
