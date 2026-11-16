import { describe, it, expect } from 'vitest';
import { validateReviewUrl, isValidReviewUrl, isValidEmail, isValidPhone, phoneDigits, normalizeLink, normalizeLinks, isUuid, isDateKey, MAX_LINKS } from '../lib/validation.js';
import { VALID_REVIEW_LINKS, INVALID_REVIEW_LINKS } from './helpers/review-links.js';

describe('Google review link validation', () => {
  it.each(VALID_REVIEW_LINKS)('accepts %s', (link) => {
    expect(validateReviewUrl(link)).toEqual({ ok: true, url: link });
  });

  it.each(INVALID_REVIEW_LINKS)('rejects %s', (link) => {
    const result = validateReviewUrl(link);
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('trims surrounding spaces and explains what is wrong', () => {
    expect(validateReviewUrl('  https://g.page/r/abc/review \n').url).toBe('https://g.page/r/abc/review');
    expect(validateReviewUrl('http://g.page/r/abc').error).toMatch(/https/);
    expect(validateReviewUrl(null).ok).toBe(false);
    expect(isValidReviewUrl(undefined)).toBe(false);
  });
});

describe('business links', () => {
  it('turns a WhatsApp number into a wa.me link (Malaysian local numbers get +60)', () => {
    expect(normalizeLink({ kind: 'whatsapp', label: '', url: '012-345 6789' }).link).toEqual({ kind: 'whatsapp', label: 'Chat on WhatsApp', url: 'https://wa.me/60123456789' });
    expect(normalizeLink({ kind: 'whatsapp', label: 'WhatsApp us', url: '+60 12 345 6789' }).link.url).toBe('https://wa.me/60123456789');
    expect(normalizeLink({ kind: 'whatsapp', label: 'x', url: 'https://wa.me/60123456789?text=Hi' }).link.url).toBe('https://wa.me/60123456789?text=Hi');
    expect(normalizeLink({ kind: 'whatsapp', label: 'x', url: '123' }).ok).toBe(false);
  });

  it('accepts handles for Instagram and TikTok, numbers for phone, addresses for email', () => {
    expect(normalizeLink({ kind: 'instagram', label: '', url: '@kopi.corner' }).link.url).toBe('https://www.instagram.com/kopi.corner');
    expect(normalizeLink({ kind: 'tiktok', label: '', url: 'kopicorner' }).link.url).toBe('https://www.tiktok.com/@kopicorner');
    expect(normalizeLink({ kind: 'instagram', label: '', url: 'https://instagram.com/kopi.corner' }).link.url).toBe('https://instagram.com/kopi.corner');
    expect(normalizeLink({ kind: 'phone', label: '', url: '03-1234 5678' }).link.url).toBe('tel:+60312345678');
    expect(normalizeLink({ kind: 'email', label: '', url: 'hello@kopi.my' }).link.url).toBe('mailto:hello@kopi.my');
    expect(normalizeLink({ kind: 'email', label: '', url: 'not-an-email' }).ok).toBe(false);
  });

  it('adds https:// to a bare domain and refuses anything that is not https', () => {
    expect(normalizeLink({ kind: 'menu', label: 'Menu', url: 'kopi.my/menu' }).link.url).toBe('https://kopi.my/menu');
    for (const url of ['http://kopi.my/menu', 'javascript:alert(1)', 'data:text/html,x', 'ftp://kopi.my', 'https://user:pw@kopi.my', 'https://localhost/menu', 'kopi menu']) {
      expect(normalizeLink({ kind: 'menu', label: 'Menu', url }).ok).toBe(false);
    }
  });

  it('requires a label for free links and limits its length', () => {
    expect(normalizeLink({ kind: 'other', label: '', url: 'https://kopi.my' }).ok).toBe(false);
    expect(normalizeLink({ kind: 'other', label: 'x'.repeat(41), url: 'https://kopi.my' }).ok).toBe(false);
    expect(normalizeLink({ kind: 'unknown-kind', label: 'Site', url: 'https://kopi.my' }).link.kind).toBe('other');
  });

  it('validates a whole page: drops empty lines, stops at the first error, caps the count', () => {
    const page = normalizeLinks([
      { kind: 'menu', label: 'Menu', url: 'https://kopi.my/menu' },
      { kind: 'other', label: '', url: '' },
      { kind: 'whatsapp', label: '', url: '0123456789' },
    ]);
    expect(page.ok).toBe(true);
    expect(page.links).toHaveLength(2);
    expect(normalizeLinks([{ kind: 'menu', label: 'Menu', url: 'nope' }]).ok).toBe(false);
    const many = Array.from({ length: MAX_LINKS + 1 }, (_, i) => ({ kind: 'other', label: `L${i}`, url: 'https://kopi.my' }));
    expect(normalizeLinks(many).ok).toBe(false);
    expect(normalizeLinks(undefined)).toEqual({ ok: true, links: [] });
  });
});

describe('small validators', () => {
  it('checks emails, phones, ids and dates', () => {
    expect(isValidEmail('owner@kopi.my')).toBe(true);
    expect(isValidEmail('owner@kopi')).toBe(false);
    expect(isValidEmail('a b@kopi.my')).toBe(false);
    expect(isValidPhone('+60 12-345 6789')).toBe(true);
    expect(isValidPhone('call me')).toBe(false);
    expect(phoneDigits('0060 12 345 6789')).toBe('60123456789');
    expect(isUuid('7b0c1f0e-52a4-4c1e-9f0a-3d2b6a1e9c11')).toBe(true);
    expect(isUuid("7b0c1f0e' or 1=1")).toBe(false);
    expect(isDateKey('2026-02-28')).toBe(true);
    expect(isDateKey('2026-02-30')).toBe(false);
    expect(isDateKey('28/02/2026')).toBe(false);
  });
});
