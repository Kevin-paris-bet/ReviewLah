import { describe, it, expect } from 'vitest';
import { klDateKey, klParts, addDays, isoWeekday, weekStart, formatDay, formatMonth, hourLabel, formatDateTime, timeAgo, previousMonthKey } from '../lib/time.js';

describe('Malaysia time helpers', () => {
  it('puts an instant on the Kuala Lumpur calendar day, not the UTC day', () => {
    // 16:30 UTC is already 00:30 the next day in Kuala Lumpur (UTC+8).
    expect(klDateKey('2026-11-15T16:30:00Z')).toBe('2026-11-16');
    expect(klDateKey('2026-11-15T15:59:59Z')).toBe('2026-11-15');
    expect(klDateKey('2026-12-31T16:00:00Z')).toBe('2027-01-01');
  });

  it('returns the local hour and weekday', () => {
    const parts = klParts('2026-11-15T16:30:00Z'); // Monday 16 Nov, 00:30 in KL
    expect(parts).toMatchObject({ year: 2026, month: 11, day: 16, hour: 0, minute: 30, weekday: 1 });
    expect(klParts('2026-11-15T04:00:00Z')).toMatchObject({ hour: 12, weekday: 7 }); // Sunday noon
  });

  it('does not depend on the time zone of the server', () => {
    const previous = process.env.TZ;
    try {
      for (const tz of ['UTC', 'America/Los_Angeles', 'Pacific/Auckland']) {
        process.env.TZ = tz;
        expect(klDateKey('2026-03-08T16:05:00Z')).toBe('2026-03-09');
        expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
        expect(weekStart('2026-03-08')).toBe('2026-03-02');
      }
    } finally {
      process.env.TZ = previous;
    }
  });

  it('does calendar arithmetic on day keys', () => {
    expect(addDays('2026-02-27', 2)).toBe('2026-03-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(isoWeekday('2026-11-16')).toBe(1);
    expect(isoWeekday('2026-11-22')).toBe(7);
    expect(weekStart('2026-11-22')).toBe('2026-11-16');
    expect(weekStart('2026-11-16')).toBe('2026-11-16');
  });

  it('finds the previous month in Kuala Lumpur, including across a year and at the UTC boundary', () => {
    expect(previousMonthKey('2026-11-16T03:00:00Z')).toBe('2026-10-01');
    expect(previousMonthKey('2027-01-01T01:00:00Z')).toBe('2026-12-01');
    // 31 Oct 17:00 UTC is already 1 Nov in KL: the previous month is October.
    expect(previousMonthKey('2026-10-31T17:00:00Z')).toBe('2026-10-01');
  });

  it('formats labels', () => {
    expect(formatDay('2026-11-03')).toBe('3 Nov');
    expect(formatDay('2026-11-03', { weekday: true, year: true })).toBe('Tue 3 Nov 2026');
    expect(formatMonth('2026-11-01')).toBe('Nov 2026');
    expect([0, 9, 12, 13, 23].map(hourLabel)).toEqual(['12 am', '9 am', '12 pm', '1 pm', '11 pm']);
    expect(formatDateTime('2026-11-16T11:35:00Z')).toBe('16 Nov 2026, 7:35 pm');
  });

  it('describes how long ago something happened', () => {
    const now = new Date('2026-11-16T12:00:00Z');
    expect(timeAgo('2026-11-16T11:59:40Z', now)).toBe('just now');
    expect(timeAgo('2026-11-16T11:15:00Z', now)).toBe('45 min ago');
    expect(timeAgo('2026-11-16T07:00:00Z', now)).toBe('5 h ago');
    expect(timeAgo('2026-11-15T10:00:00Z', now)).toBe('yesterday');
    expect(timeAgo('2026-11-10T12:00:00Z', now)).toBe('6 days ago');
    expect(timeAgo('2026-08-01T12:00:00Z', now)).toBe('1 Aug 2026');
  });
});
