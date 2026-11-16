// One plain layout for short transactional emails (billing notices, review alerts).
import { escapeHtml as esc } from './send';

/** paragraphs: strings; button: { href, text }; footer: string. Returns { html, text }. */
export function simpleEmail({ heading, paragraphs = [], button = null, footer = '' }) {
  const text = [heading, '', ...paragraphs.flatMap((p) => [p, '']), ...(button ? [`${button.text}: ${button.href}`, ''] : []), footer].join('\n').trim();
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f5f8fd;font-family:Arial,Helvetica,sans-serif;color:#0b2143">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f8fd"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #dce6f3;border-radius:16px"><tr><td style="padding:24px">
    <div style="font-size:20px;font-weight:800;color:#0b2143">ReviewLah<span style="background:#1555ef;color:#fff;border-radius:4px;padding:0 3px;margin-left:2px">.my</span></div>
    <h1 style="font-size:20px;line-height:1.3;margin:18px 0 10px">${esc(heading)}</h1>
    ${paragraphs.map((p) => `<p style="font-size:15px;line-height:1.6;margin:0 0 12px;white-space:pre-wrap">${esc(p)}</p>`).join('')}
    ${button ? `<p style="margin:18px 0 6px"><a href="${esc(button.href)}" style="display:inline-block;background:#1555ef;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;border-radius:9px;padding:12px 20px">${esc(button.text)}</a></p>` : ''}
    ${footer ? `<p style="font-size:12px;line-height:1.6;color:#536780;margin:18px 0 0">${esc(footer)}</p>` : ''}
  </td></tr></table>
</td></tr></table></body></html>`;
  return { html, text };
}
