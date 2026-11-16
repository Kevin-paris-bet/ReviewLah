import { describe, it, expect } from 'vitest';
import { scanSource, isBot, isPrefetch, clientIp, deviceHash, CODE_PATTERN } from '../lib/scan.js';
import { csvCell, toCsv, safeFilename } from '../lib/csv.js';

describe('plate redirect helpers', () => {
  it('reads the scan source from the address', () => {
    expect(scanSource(new URL('https://go.reviewlah.my/A7X92?nfc').searchParams)).toBe('nfc');
    expect(scanSource(new URL('https://go.reviewlah.my/A7X92?qr').searchParams)).toBe('qr');
    expect(scanSource(new URL('https://go.reviewlah.my/A7X92').searchParams)).toBe('other');
    expect(scanSource(new URL('https://go.reviewlah.my/A7X92?utm_source=x').searchParams)).toBe('other');
  });

  it('accepts only short alphanumeric plate codes', () => {
    expect(CODE_PATTERN.test('A7X92')).toBe(true);
    expect(CODE_PATTERN.test('a7x92')).toBe(true);
    for (const bad of ['', 'ab', 'A7X92/..', 'A7 X92', "A7X92'--", 'A'.repeat(17)]) expect(CODE_PATTERN.test(bad)).toBe(false);
  });

  it('does not count link previews and crawlers, but counts real phones', () => {
    for (const ua of ['WhatsApp/2.23.20.0', 'facebookexternalhit/1.1', 'Mozilla/5.0 (compatible; Googlebot/2.1)', 'Slackbot-LinkExpanding 1.0', 'curl/8.4.0', 'TelegramBot (like TwitterBot)', '', null]) {
      expect(isBot(ua)).toBe(true);
    }
    for (const ua of [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Linux; Android 15; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
      'Mozilla/5.0 (Linux; Android 14; 23106RN0DA) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
    ]) {
      expect(isBot(ua)).toBe(false);
    }
  });

  it('does not count browser prefetches', () => {
    expect(isPrefetch(new Headers({ 'sec-purpose': 'prefetch;prerender' }))).toBe(true);
    expect(isPrefetch(new Headers({ purpose: 'prefetch' }))).toBe(true);
    expect(isPrefetch(new Headers({ 'x-moz': 'prefetch' }))).toBe(true);
    expect(isPrefetch(new Headers({ accept: 'text/html' }))).toBe(false);
  });

  it('takes the first forwarded address as the client address', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7');
    expect(clientIp(new Headers({ 'x-real-ip': '203.0.113.9' }))).toBe('203.0.113.9');
    expect(clientIp(new Headers())).toBe('');
  });

  it('builds a device fingerprint that never contains the IP address', () => {
    const base = { ip: '203.0.113.7', userAgent: 'Mozilla/5.0 (iPhone)', code: 'a7x92', day: '2026-11-16', secret: 'test-secret' };
    const hash = deviceHash(base);
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
    expect(hash).not.toContain('203');
    expect(deviceHash({ ...base, code: 'A7X92' })).toBe(hash); // same plate, same device, same day
    expect(deviceHash({ ...base, ip: '203.0.113.8' })).not.toBe(hash);
    expect(deviceHash({ ...base, userAgent: 'Mozilla/5.0 (Android)' })).not.toBe(hash);
    expect(deviceHash({ ...base, code: 'OTHER' })).not.toBe(hash); // cannot follow a device across plates
    expect(deviceHash({ ...base, day: '2026-11-17' })).not.toBe(hash); // nor across days
    expect(deviceHash({ ...base, secret: 'another-secret' })).not.toBe(hash);
    // Without the optional secret the fingerprint still works (the database salts it again).
    const unkeyed = deviceHash({ ...base, secret: '' });
    expect(unkeyed).toMatch(/^[0-9a-f]{32}$/);
    expect(unkeyed).not.toBe(hash);
    expect(deviceHash({ ...base, ip: '' })).toBeNull(); // unknown address: no de-duplication
  });
});

describe('CSV export', () => {
  it('quotes what needs quoting and neutralises spreadsheet formulas', () => {
    expect(csvCell('Counter')).toBe('Counter');
    expect(csvCell('Table 4, window')).toBe('"Table 4, window"');
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvCell('=HYPERLINK("http://evil")')).toBe('"\'=HYPERLINK(""http://evil"")"');
    expect(csvCell('+60123')).toBe("'+60123");
    expect(csvCell(null)).toBe('');
    expect(csvCell(0)).toBe('0');
  });

  it('writes a header and one line per row', () => {
    const csv = toCsv([{ a: 1, b: 'x' }, { a: 2, b: 'y,z' }], [{ key: 'a', header: 'A' }, { key: 'b', header: 'B' }]);
    expect(csv).toBe('A,B\r\n1,x\r\n2,"y,z"\r\n');
    expect(safeFilename('Kopi Corner – Bangsar!')).toBe('kopi-corner-bangsar');
  });
});
