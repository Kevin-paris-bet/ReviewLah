import { describe, it, expect } from 'vitest';
import { pctChange, trend, share, groupWeekly, bestDay, peakHour, peakWeekday, dayParts, niceMax, dailyAverage } from '../lib/stats.js';

const day = (d, total, nfc = 0, qr = 0) => ({ d, total, nfc, qr, other: total - nfc - qr });

describe('scan statistics helpers', () => {
  it('computes the change against the previous period', () => {
    expect(pctChange(120, 100)).toBe(20);
    expect(pctChange(50, 100)).toBe(-50);
    expect(pctChange(0, 0)).toBe(0);
    expect(pctChange(7, 0)).toBeNull(); // nothing to compare with: never "+infinity%"
    expect(trend(120, 100)).toEqual({ direction: 'up', pct: 20, text: '+20%' });
    expect(trend(75, 100)).toEqual({ direction: 'down', pct: -25, text: '−25%' });
    expect(trend(10, 10).direction).toBe('flat');
    expect(trend(3, 0)).toEqual({ direction: 'new', pct: null, text: 'New activity' });
  });

  it('computes shares without dividing by zero', () => {
    expect(share(3, 4)).toBe(75);
    expect(share(1, 3)).toBe(33);
    expect(share(0, 0)).toBe(0);
  });

  it('groups days into Monday–Sunday weeks and flags incomplete weeks', () => {
    // Thu 5 Nov → Wed 18 Nov 2026: two days short at each end.
    const days = [];
    for (let i = 5; i <= 18; i += 1) days.push(day(`2026-11-${String(i).padStart(2, '0')}`, i, 1, 2));
    const weeks = groupWeekly(days);
    expect(weeks.map((w) => [w.start, w.end, w.days, w.partial])).toEqual([
      ['2026-11-02', '2026-11-08', 4, true],
      ['2026-11-09', '2026-11-15', 7, false],
      ['2026-11-16', '2026-11-22', 3, true],
    ]);
    expect(weeks[1].total).toBe(9 + 10 + 11 + 12 + 13 + 14 + 15);
    expect(weeks[1].nfc).toBe(7);
    expect(weeks[1].qr).toBe(14);
    expect(weeks.reduce((sum, w) => sum + w.total, 0)).toBe(days.reduce((sum, d) => sum + d.total, 0));
    expect(weeks[0].label).toBe('2 Nov');
  });

  it('finds the busiest day, hour and weekday', () => {
    expect(bestDay([day('2026-11-01', 2), day('2026-11-02', 9), day('2026-11-03', 9)])).toEqual({ d: '2026-11-02', total: 9 });
    expect(bestDay([day('2026-11-01', 0)])).toBeNull();

    const hours = new Array(24).fill(0);
    hours[13] = 12;
    hours[19] = 30;
    expect(peakHour(hours)).toEqual({ hour: 19, count: 30, label: '7 pm–8 pm' });
    expect(peakHour(new Array(24).fill(0))).toBeNull();
    hours[23] = 99;
    expect(peakHour(hours).label).toBe('11 pm–12 am');

    expect(peakWeekday([1, 2, 3, 4, 5, 20, 6])).toEqual({ isoDay: 6, count: 20, name: 'Saturday' });
    expect(peakWeekday([0, 0, 0, 0, 0, 0, 0])).toBeNull();
  });

  it('splits the day into four parts that add up to the total', () => {
    const hours = new Array(24).fill(1); // 24 scans, one per hour
    const parts = dayParts(hours);
    expect(parts.map((p) => p.count)).toEqual([6, 5, 5, 8]);
    expect(parts.reduce((sum, p) => sum + p.count, 0)).toBe(24);
    expect(dayParts(new Array(24).fill(0)).every((p) => p.share === 0)).toBe(true);
  });

  it('picks a readable chart maximum whose quarter steps are whole numbers', () => {
    expect(niceMax([])).toBe(4);
    expect(niceMax([0, 3])).toBe(4);
    expect(niceMax([7])).toBe(8);
    expect(niceMax([9])).toBe(12);
    expect(niceMax([18])).toBe(20);
    expect(niceMax([34])).toBe(40);
    expect(niceMax([64])).toBe(80);
    expect(niceMax([124])).toBe(160);
    expect(niceMax([1000])).toBe(1000);
    for (const value of [5, 9, 13, 21, 37, 55, 71, 99, 101, 250, 777, 1234, 9999]) {
      const max = niceMax([value]);
      expect(max).toBeGreaterThanOrEqual(value);
      expect(Number.isInteger(max / 4), `${value} -> ${max}`).toBe(true);
    }
  });

  it('averages scans per day', () => {
    expect(dailyAverage([day('2026-11-01', 3), day('2026-11-02', 4)])).toBe(3.5);
    expect(dailyAverage([])).toBe(0);
  });
});
