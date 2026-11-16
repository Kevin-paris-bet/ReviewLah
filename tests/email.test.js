import { describe, it, expect } from 'vitest';
import { buildMonthlySummary, locationFacts, reviewFacts } from '../lib/email/monthly.js';

const entry = {
  company_id: 'c1', company_name: 'Kopi <Corner> & Co', email: 'aisha@kopicorner.my', contact_name: 'Aisha Rahman',
  month: '2026-10-01',
  businesses: [
    {
      id: 'b1', name: 'Kopi Corner Bangsar', total: 132, prev_total: 110, nfc: 90, qr: 40,
      best_day: { d: '2026-10-17', n: 14 }, peak_hour: 13, peak_weekday: 6, all_time_total: 870,
      plates: [{ code: 'A7X92', label: 'Counter', total: 100 }, { code: 'B2K4M', label: null, total: 32 }],
    },
    { id: 'b2', name: 'Kopi Corner TTDI', total: 0, prev_total: 0, nfc: 0, qr: 0, best_day: null, peak_hour: null, peak_weekday: null, all_time_total: 12, plates: [{ code: 'C9P3Q', label: null, total: 0 }] },
  ],
};
const options = { siteUrl: 'https://www.reviewlah.my', legalName: 'Example LLC' };

describe('monthly summary email', () => {
  it('puts the month, the total and the change in the subject', () => {
    const { subject } = buildMonthlySummary(entry, options);
    expect(subject).toBe('October 2026: 132 plate scans (+20%) — Kopi <Corner> & Co');
  });

  it('never presents scans as reviews', () => {
    const { html, text } = buildMonthlySummary(entry, options);
    for (const body of [html, text]) {
      expect(body).toContain('It does not prove that a review was posted');
      expect(body).not.toMatch(/132 reviews/i);
    }
    expect(text).not.toContain('Google reviews');
  });

  it('escapes customer text in the HTML version', () => {
    const { html } = buildMonthlySummary(entry, options);
    expect(html).toContain('Kopi &lt;Corner&gt; &amp; Co');
    expect(html).not.toContain('Kopi <Corner>');
  });

  it('compares with the previous month and lists Malaysia-time peaks', () => {
    const facts = locationFacts(entry.businesses[0], 'September');
    expect(facts.trend).toBe('+20% vs September (110)');
    expect(Object.fromEntries(facts.facts)).toMatchObject({
      'NFC taps': '90 (68%)', 'QR scans': '40 (30%)', 'Best day': 'Sat 17 Oct (14 scans)',
      'Busiest day of the week': 'Saturday', 'Busiest hour': '1 pm–2 pm', 'All-time scans': '870',
    });
    const quiet = locationFacts(entry.businesses[1], 'September');
    expect(quiet.trend).toBe('Same as September');
    expect(quiet.facts).toEqual([['All-time scans', '12']]);
  });

  it('lists each plate only when a location has several', () => {
    const { text } = buildMonthlySummary(entry, options);
    expect(text).toContain('Counter (A7X92): 100 scans');
    expect(text).not.toContain('Plate C9P3Q');
  });

  it('adds Google review trends, kept apart from scans, only for connected locations', () => {
    const reviews = { b1: { new_reviews: 9, prev_new_reviews: 6, avg_rating: 4.56, prev_avg_rating: 4.2, low_ratings: 1, unreplied: 2, total_reviews: 140, avg_all: 4.61 } };
    const { text, html } = buildMonthlySummary(entry, { ...options, reviews });
    expect(text).toContain('Google reviews (from your connected Google Business Profile)');
    expect(text).toContain('New reviews: 9 (September: 6)');
    expect(text).toContain('Average rating of new reviews: 4.6 / 5, September: 4.2');
    expect(text).toContain('Reviews waiting for a reply: 2');
    expect(html).toContain('Counted separately from scans');
    expect(reviewFacts(undefined, 'September')).toBeNull();
  });

  it('links to the dashboard and to the setting that turns the email off', () => {
    const { text } = buildMonthlySummary(entry, options);
    expect(text).toContain('https://www.reviewlah.my/dashboard/analytics');
    expect(text).toContain('https://www.reviewlah.my/dashboard/account');
    expect(text.startsWith('Hello Aisha,')).toBe(true);
  });
});
