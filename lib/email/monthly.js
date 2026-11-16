// Monthly summary email (Pro): scans and trends for each Pro location of one customer, plus Google
// review trends when Google is connected. Pure functions: the figures come from the SQL functions
// monthly_summary_data() and monthly_review_data(), already bucketed in Malaysia time.
import { trend, share } from '../stats.js';
import { formatMonth, formatDay, hourLabel, weekdayName } from '../time.js';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = (value) => (Number(value) || 0).toLocaleString('en-MY');

function trendText(current, previous, previousLabel) {
  const t = trend(current, previous);
  if (t.direction === 'new') return `No scans in ${previousLabel} to compare with`;
  if (t.direction === 'flat') return `Same as ${previousLabel}`;
  return `${t.text} vs ${previousLabel} (${n(previous)})`;
}

/** Plain facts about one location's month, shared by the HTML and the text versions. */
export function locationFacts(b, previousLabel) {
  const total = Number(b.total) || 0;
  const facts = [];
  if (total > 0) {
    facts.push(['NFC taps', `${n(b.nfc)} (${share(b.nfc, total)}%)`]);
    facts.push(['QR scans', `${n(b.qr)} (${share(b.qr, total)}%)`]);
    if (b.best_day) facts.push(['Best day', `${formatDay(b.best_day.d, { weekday: true })} (${n(b.best_day.n)} scans)`]);
    if (b.peak_weekday) facts.push(['Busiest day of the week', weekdayName(b.peak_weekday)]);
    if (b.peak_hour !== null && b.peak_hour !== undefined) facts.push(['Busiest hour', `${hourLabel(b.peak_hour)}–${hourLabel(b.peak_hour + 1)}`]);
  }
  facts.push(['All-time scans', n(b.all_time_total)]);
  return { total, trend: trendText(total, b.prev_total, previousLabel), facts };
}

/** Google review figures of one location for the month, or null when Google is not connected. */
export function reviewFacts(r, previousLabel) {
  if (!r) return null;
  const facts = [];
  const count = Number(r.new_reviews) || 0;
  facts.push(['New reviews', `${n(count)} (${previousLabel}: ${n(r.prev_new_reviews)})`]);
  if (count > 0 && r.avg_rating !== null && r.avg_rating !== undefined) {
    const prev = r.prev_avg_rating !== null && r.prev_avg_rating !== undefined ? `, ${previousLabel}: ${Number(r.prev_avg_rating).toFixed(1)}` : '';
    facts.push(['Average rating of new reviews', `${Number(r.avg_rating).toFixed(1)} / 5${prev}`]);
  }
  if (Number(r.low_ratings) > 0) facts.push(['Reviews with 1 or 2 stars', n(r.low_ratings)]);
  if (Number(r.unreplied) > 0) facts.push(['Reviews waiting for a reply', n(r.unreplied)]);
  if (Number(r.total_reviews) > 0 && r.avg_all !== null && r.avg_all !== undefined) {
    facts.push(['All imported reviews', `${n(r.total_reviews)}, average ${Number(r.avg_all).toFixed(1)} / 5`]);
  }
  return { count, facts };
}

/**
 * entry: one element of monthly_summary_data(); reviews: { [business_id]: figures } or undefined.
 * Returns { subject, html, text }.
 */
export function buildMonthlySummary(entry, { reviews = {}, siteUrl, legalName = '' } = {}) {
  const monthLong = formatMonth(entry.month, { long: true });
  const previous = new Date(`${String(entry.month).slice(0, 10)}T00:00:00Z`);
  previous.setUTCMonth(previous.getUTCMonth() - 1);
  const previousLabel = formatMonth(previous.toISOString().slice(0, 10), { long: true }).split(' ')[0];
  const businesses = entry.businesses || [];
  const grandTotal = businesses.reduce((sum, b) => sum + (Number(b.total) || 0), 0);
  const grandPrev = businesses.reduce((sum, b) => sum + (Number(b.prev_total) || 0), 0);
  const overall = trend(grandTotal, grandPrev);
  const change = overall.direction === 'up' || overall.direction === 'down' ? ` (${overall.text})` : '';
  const subject = `${monthLong}: ${n(grandTotal)} plate ${grandTotal === 1 ? 'scan' : 'scans'}${change} — ${entry.company_name}`;
  const hello = entry.contact_name ? `Hello ${String(entry.contact_name).split(' ')[0]},` : 'Hello,';
  const intro = `Here is how your ReviewLah ${businesses.length > 1 || businesses.some((b) => (b.plates || []).length > 1) ? 'plates were' : 'plate was'} used in ${monthLong}.`;
  const scanNote = 'A scan means someone tapped or scanned your plate and your Google review page opened. It does not prove that a review was posted.';
  const dashboard = `${siteUrl}/dashboard/analytics`;
  const settings = `${siteUrl}/dashboard/account`;

  const blocks = businesses.map((b) => {
    const facts = locationFacts(b, previousLabel);
    const review = reviewFacts(reviews[b.id], previousLabel);
    const plates = (b.plates || []).length > 1 ? b.plates : [];
    return { b, facts, review, plates };
  });

  // Text version
  const lines = [hello, '', intro, ''];
  for (const { b, facts, review, plates } of blocks) {
    lines.push(`${b.name}`, `${n(facts.total)} scans — ${facts.trend}`);
    for (const [label, value] of facts.facts) lines.push(`  ${label}: ${value}`);
    for (const p of plates) lines.push(`  ${p.label ? `${p.label} (${p.code})` : `Plate ${p.code}`}: ${n(p.total)} scans`);
    if (review) {
      lines.push('  Google reviews (from your connected Google Business Profile)');
      for (const [label, value] of review.facts) lines.push(`    ${label}: ${value}`);
    }
    lines.push('');
  }
  lines.push(scanNote, '', `Full analytics: ${dashboard}`, '', `You receive this email because the monthly summary is on for ${entry.company_name}. Turn it off in your account: ${settings}`);
  if (legalName) lines.push(legalName);

  // HTML version (tables and inline styles: the only layout every mail app respects)
  const row = (label, value) => `<tr><td style="padding:6px 0;color:#536780;font-size:14px">${esc(label)}</td><td style="padding:6px 0;text-align:right;font-size:14px;color:#0b2143;font-weight:600">${esc(value)}</td></tr>`;
  const htmlBlocks = blocks.map(({ b, facts, review, plates }) => `
    <tr><td style="padding:22px 24px 6px">
      <div style="font-size:17px;font-weight:700;color:#0b2143">${esc(b.name)}</div>
      <div style="font-size:40px;line-height:1.1;font-weight:800;color:#1555ef;margin:6px 0 2px">${n(facts.total)}</div>
      <div style="font-size:14px;color:#536780">scans in ${esc(monthLong)} · ${esc(facts.trend)}</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;border-top:1px solid #dce6f3">
        ${facts.facts.map(([label, value]) => row(label, value)).join('')}
        ${plates.map((p) => row(p.label ? `${p.label} (${p.code})` : `Plate ${p.code}`, `${n(p.total)} scans`)).join('')}
      </table>
      ${review ? `
      <div style="margin-top:14px;font-size:13px;font-weight:700;letter-spacing:.04em;color:#102b50">GOOGLE REVIEWS</div>
      <div style="font-size:12px;color:#536780">From your connected Google Business Profile. Counted separately from scans.</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;border-top:1px solid #dce6f3">
        ${review.facts.map(([label, value]) => row(label, value)).join('')}
      </table>` : ''}
    </td></tr>`).join('');

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;background:#f5f8fd;font-family:Arial,Helvetica,sans-serif;color:#0b2143">
<div style="display:none;max-height:0;overflow:hidden">${n(grandTotal)} scans in ${esc(monthLong)}${esc(change)}.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f8fd"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #dce6f3;border-radius:16px">
    <tr><td style="padding:22px 24px 0">
      <div style="font-size:20px;font-weight:800;color:#0b2143">ReviewLah<span style="background:#1555ef;color:#fff;border-radius:4px;padding:0 3px;margin-left:2px">.my</span></div>
      <p style="font-size:15px;line-height:1.6;margin:16px 0 0">${esc(hello)}</p>
      <p style="font-size:15px;line-height:1.6;margin:6px 0 0">${esc(intro)}</p>
    </td></tr>
    ${htmlBlocks}
    <tr><td style="padding:18px 24px 6px">
      <a href="${esc(dashboard)}" style="display:inline-block;background:#1555ef;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;border-radius:9px;padding:12px 20px">Open full analytics</a>
    </td></tr>
    <tr><td style="padding:12px 24px 22px">
      <p style="font-size:12px;line-height:1.6;color:#536780;margin:0 0 8px">${esc(scanNote)}</p>
      <p style="font-size:12px;line-height:1.6;color:#536780;margin:0">You receive this email because the monthly summary is on for ${esc(entry.company_name)}. <a href="${esc(settings)}" style="color:#536780">Turn it off in your account</a>.${legalName ? ` ${esc(legalName)}.` : ''}</p>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;

  return { subject, html, text: lines.join('\n') };
}
