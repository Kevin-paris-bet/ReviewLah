// All dashboard dates are shown in Malaysia time. Malaysia has a single time zone (UTC+8, no DST).
export const KL_TZ = 'Asia/Kuala_Lumpur';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const WEEKDAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const partsFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: KL_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

/** Calendar parts of an instant, as seen on a clock in Kuala Lumpur. */
export function klParts(date = new Date()) {
  const out = {};
  for (const part of partsFormat.formatToParts(new Date(date))) {
    if (part.type !== 'literal') out[part.type] = Number(part.value);
  }
  const key = `${out.year}-${pad(out.month)}-${pad(out.day)}`;
  return { year: out.year, month: out.month, day: out.day, hour: out.hour, minute: out.minute, second: out.second, key, weekday: isoWeekday(key) };
}

/** 'YYYY-MM-DD' of an instant in Kuala Lumpur. */
export function klDateKey(date = new Date()) {
  return klParts(date).key;
}

/** First day ('YYYY-MM-01') of the month before the one `date` falls in, in Kuala Lumpur. */
export function previousMonthKey(date = new Date()) {
  const { year, month } = klParts(date);
  const y = month === 1 ? year - 1 : year;
  const m = month === 1 ? 12 : month - 1;
  return `${y}-${pad(m)}-01`;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

// Day keys are plain calendar dates: arithmetic on them is done in UTC so that it can never
// shift by a day depending on where the server runs.
function keyToUtc(key) {
  const [y, m, d] = String(key).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function utcToKey(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function addDays(key, days) {
  const date = keyToUtc(key);
  date.setUTCDate(date.getUTCDate() + days);
  return utcToKey(date);
}

/** ISO weekday of a day key: 1 = Monday … 7 = Sunday. */
export function isoWeekday(key) {
  const day = keyToUtc(key).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Monday of the week a day key falls in. */
export function weekStart(key) {
  return addDays(key, 1 - isoWeekday(key));
}

export function weekdayName(isoDay, short = false) {
  return (short ? WEEKDAYS_SHORT : WEEKDAYS)[isoDay - 1] || '';
}

/** '3 Nov' (or 'Mon 3 Nov' / '3 Nov 2026'). */
export function formatDay(key, { weekday = false, year = false } = {}) {
  const date = keyToUtc(key);
  let text = `${date.getUTCDate()} ${MONTHS_SHORT[date.getUTCMonth()]}`;
  if (weekday) text = `${WEEKDAYS_SHORT[isoWeekday(key) - 1]} ${text}`;
  if (year) text += ` ${date.getUTCFullYear()}`;
  return text;
}

/** 'Nov 2026' (or 'November 2026') from 'YYYY-MM-DD'. */
export function formatMonth(key, { long = false } = {}) {
  const date = keyToUtc(key);
  return `${(long ? MONTHS : MONTHS_SHORT)[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** '9 am', '12 pm', '11 pm'. */
export function hourLabel(hour) {
  const h = ((hour % 24) + 24) % 24;
  const suffix = h < 12 ? 'am' : 'pm';
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve} ${suffix}`;
}

/** '16 Nov 2026, 7:35 pm' in Malaysia time. */
export function formatDateTime(value) {
  if (!value) return '';
  const p = klParts(value);
  const suffix = p.hour < 12 ? 'am' : 'pm';
  const twelve = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${p.day} ${MONTHS_SHORT[p.month - 1]} ${p.year}, ${twelve}:${pad(p.minute)} ${suffix}`;
}

/** '16 Nov 2026' in Malaysia time. */
export function formatDate(value) {
  if (!value) return '';
  const p = klParts(value);
  return `${p.day} ${MONTHS_SHORT[p.month - 1]} ${p.year}`;
}

/** 'just now', '5 min ago', '3 h ago', 'yesterday', '4 days ago', then a date. */
export function timeAgo(value, now = new Date()) {
  if (!value) return '';
  const seconds = Math.max(0, Math.round((new Date(now).getTime() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  const days = Math.floor(seconds / 86400);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return formatDate(value);
}
