// Pure helpers on top of the figures returned by the SQL functions (supabase/migrations/0002_stats.sql).
// The SQL does the counting and the Malaysia-time bucketing; this file only reshapes and labels.
import { addDays, weekStart, weekdayName, hourLabel, formatDay } from './time.js';

/** Percentage change, or null when there is nothing to compare with (previous = 0 and current > 0). */
export function pctChange(current, previous) {
  const cur = Number(current) || 0;
  const prev = Number(previous) || 0;
  if (prev === 0) return cur === 0 ? 0 : null;
  return Math.round(((cur - prev) / prev) * 100);
}

/** { direction: 'up' | 'down' | 'flat' | 'new', pct, text } for "vs previous period" labels. */
export function trend(current, previous) {
  const pct = pctChange(current, previous);
  if (pct === null) return { direction: 'new', pct: null, text: 'New activity' };
  if (pct === 0) return { direction: 'flat', pct: 0, text: 'No change' };
  return { direction: pct > 0 ? 'up' : 'down', pct, text: `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%` };
}

/** Share of a part in a total, as a whole percentage (0 when the total is 0). */
export function share(part, total) {
  const t = Number(total) || 0;
  return t === 0 ? 0 : Math.round(((Number(part) || 0) / t) * 100);
}

/**
 * Groups the daily series into Monday–Sunday weeks. A week that is cut by the start of the
 * period is flagged `partial` so the chart can say so instead of looking like a drop.
 */
export function groupWeekly(daily = []) {
  const weeks = new Map();
  for (const day of daily) {
    const start = weekStart(day.d);
    if (!weeks.has(start)) {
      weeks.set(start, { start, end: addDays(start, 6), days: 0, total: 0, nfc: 0, qr: 0, other: 0 });
    }
    const week = weeks.get(start);
    week.days += 1;
    week.total += Number(day.total) || 0;
    week.nfc += Number(day.nfc) || 0;
    week.qr += Number(day.qr) || 0;
    week.other += Number(day.other) || 0;
  }
  return [...weeks.values()].map((week) => ({ ...week, partial: week.days < 7, label: formatDay(week.start) }));
}

/** Busiest day of the daily series, or null when there are no scans. */
export function bestDay(daily = []) {
  let best = null;
  for (const day of daily) {
    if ((Number(day.total) || 0) > (best ? best.total : 0)) best = { d: day.d, total: Number(day.total) };
  }
  return best;
}

/** Busiest hour of the day (0–23), or null when there are no scans. */
export function peakHour(hours = []) {
  let best = null;
  hours.forEach((count, hour) => {
    if ((Number(count) || 0) > (best ? best.count : 0)) best = { hour, count: Number(count) };
  });
  return best ? { ...best, label: `${hourLabel(best.hour)}–${hourLabel(best.hour + 1)}` } : null;
}

/** Busiest weekday; `weekdays` is Monday-first (7 values). Null when there are no scans. */
export function peakWeekday(weekdays = []) {
  let best = null;
  weekdays.forEach((count, index) => {
    if ((Number(count) || 0) > (best ? best.count : 0)) best = { isoDay: index + 1, count: Number(count) };
  });
  return best ? { ...best, name: weekdayName(best.isoDay) } : null;
}

const DAY_PARTS = [
  { key: 'morning', label: 'Morning', range: '6 am–12 pm', from: 6, to: 12 },
  { key: 'afternoon', label: 'Afternoon', range: '12 pm–5 pm', from: 12, to: 17 },
  { key: 'evening', label: 'Evening', range: '5 pm–10 pm', from: 17, to: 22 },
  { key: 'night', label: 'Night', range: '10 pm–6 am', from: 22, to: 30 },
];

/** Scans grouped into four parts of the day, with each part's share of the total. */
export function dayParts(hours = []) {
  const total = hours.reduce((sum, n) => sum + (Number(n) || 0), 0);
  return DAY_PARTS.map((part) => {
    let count = 0;
    for (let h = part.from; h < part.to; h += 1) count += Number(hours[h % 24]) || 0;
    return { key: part.key, label: part.label, range: part.range, count, share: share(count, total) };
  });
}

/** A round axis maximum at or above the largest value (at least 4, so empty charts keep a scale). */
export function niceMax(values = []) {
  const max = Math.max(0, ...values.map((v) => Number(v) || 0));
  if (max <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (max <= step * magnitude) return step * magnitude;
  }
  return 10 * magnitude;
}

/** Average scans per day over the daily series (one decimal). */
export function dailyAverage(daily = []) {
  if (!daily.length) return 0;
  const total = daily.reduce((sum, day) => sum + (Number(day.total) || 0), 0);
  return Math.round((total / daily.length) * 10) / 10;
}
