import { requireAdmin } from '../../../lib/admin';
import { adminClient } from '../../../lib/supabase/admin';
import { configStatus, siteUrl, goUrl } from '../../../lib/env';
import { knownProviders } from '../../../lib/payments';
import { formatDateTime } from '../../../lib/time';
import { Flash } from '../../ui/parts';
import { Submit } from '../../ui/client';
import { runMaintenance } from '../actions';

export const metadata = { title: 'System' };

// What each environment variable switches on. Values are never shown, only whether they are set.
const GROUPS = [
  ['Server', [
    ['SUPABASE_SECRET_KEY', 'Webhooks, scheduled jobs, emails and the Google connection'],
    ['CRON_SECRET', 'Protects the daily scheduled job'],
    ['SCAN_HASH_SECRET', 'Extra key for the scan de-duplication fingerprint (optional)'],
  ]],
  ['Email', [
    ['RESEND_API_KEY', 'Monthly summary, billing notices, review alerts'],
    ['EMAIL_FROM', 'Sender shown on emails (optional, defaults to hello@reviewlah.my)'],
    ['SUPPORT_EMAIL', 'Where dashboard support messages are forwarded, shown on the help page'],
    ['SUPPORT_WHATSAPP', 'WhatsApp button on the help and plan pages (optional)'],
    ['LEGAL_ENTITY_NAME', 'Company name shown on /privacy, /terms and email footers'],
  ]],
  ['Payment', [
    ['PAYMENT_PROVIDER', 'Which provider opens new checkouts (airwallex). Empty: Pro is manual only'],
    ['AIRWALLEX_CLIENT_ID', 'Airwallex API client id'],
    ['AIRWALLEX_API_KEY', 'Airwallex API key'],
    ['AIRWALLEX_WEBHOOK_SECRET', 'Verifies Airwallex webhooks'],
    ['AIRWALLEX_PRICE_MONTHLY', 'Price id of RM29 / month'],
    ['AIRWALLEX_PRICE_YEARLY', 'Price id of RM290 / year'],
  ]],
  ['Google Business Profile', [
    ['GBP_ENABLED', 'Shows the Google connection and the Reviews tab (off by default)'],
    ['GOOGLE_CLIENT_ID', 'OAuth client id'],
    ['GOOGLE_CLIENT_SECRET', 'OAuth client secret'],
    ['TOKEN_ENCRYPTION_KEY', 'Encrypts Google tokens before they are stored'],
    ['GOOGLE_PUBSUB_TOPIC', 'Pub/Sub topic for new review alerts'],
    ['GOOGLE_PUBSUB_SERVICE_ACCOUNT', 'Service account that signs the Pub/Sub push messages'],
    ['ANTHROPIC_API_KEY', 'AI reply drafts (Claude API)'],
  ]],
];

export default async function System({ searchParams }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const status = configStatus();
  const admin = adminClient();
  const events = admin
    ? (await admin.from('payment_events').select('id,provider,event_type,outcome,error,received_at').order('received_at', { ascending: false }).limit(15)).data || []
    : [];
  const emails = (await supabase.from('email_log').select('id,kind,period,to_email,status,error,created_at').order('created_at', { ascending: false }).limit(15)).data || [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>System</h1>
          <p className="muted">Which services are configured. Secrets live in Vercel environment variables only; their values are never displayed here.</p>
        </div>
      </div>
      <Flash sp={sp} />

      {GROUPS.map(([title, rows]) => (
        <section className="card" key={title} aria-label={title}>
          <h2>{title}</h2>
          <div className="table-wrap">
            <table>
              <tbody>
                {rows.map(([name, purpose]) => {
                  const value = status[name];
                  return (
                    <tr key={name}>
                      <td><code>{name}</code></td>
                      <td>{purpose}</td>
                      <td className="nowrap">
                        {value ? <span className="badge on">{typeof value === 'string' ? value.toUpperCase() : 'SET'}</span> : <span className="badge plain">NOT SET</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <section className="card" aria-labelledby="addresses">
        <h2 id="addresses">Addresses to register elsewhere</h2>
        <dl className="kv">
          <dt>Plate address</dt><dd><code>{goUrl('CODE', 'nfc')}</code></dd>
          {knownProviders().map((p) => (
            <span key={p} style={{ display: 'contents' }}><dt>Webhook ({p})</dt><dd><code>{`${siteUrl()}/api/webhooks/${p}`}</code></dd></span>
          ))}
          <dt>Google OAuth redirect</dt><dd><code>{`${siteUrl()}/api/google/callback`}</code></dd>
          <dt>Google Pub/Sub push</dt><dd><code>{`${siteUrl()}/api/google/notifications`}</code></dd>
          <dt>Daily job</dt><dd><code>{`${siteUrl()}/api/cron/daily`}</code> (Vercel Cron, 09:00 Malaysia time)</dd>
        </dl>
        <form action={runMaintenance}>
          <Submit className="btn out small" pending="Running…">Run the daily maintenance now</Submit>
        </form>
        <p className="hint">Closes subscriptions whose period is over and erases old de-duplication fingerprints. Safe to run at any time.</p>
      </section>

      <section className="card" aria-labelledby="events">
        <h2 id="events">Latest payment events</h2>
        {!admin && <p className="muted">Set SUPABASE_SECRET_KEY to see webhook deliveries here.</p>}
        {admin && events.length === 0 && <p className="muted">No webhook received yet.</p>}
        {events.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Received</th><th>Provider</th><th>Event</th><th>Outcome</th></tr></thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td className="nowrap">{formatDateTime(e.received_at)}</td>
                    <td>{e.provider}</td>
                    <td>{e.event_type}</td>
                    <td>{e.outcome || 'received'}{e.error ? ` (${e.error})` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="emails">
        <h2 id="emails">Latest emails</h2>
        {emails.length === 0 ? <p className="muted">No email sent yet.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Sent</th><th>Kind</th><th>To</th><th>Status</th></tr></thead>
              <tbody>
                {emails.map((e) => (
                  <tr key={e.id}>
                    <td className="nowrap">{formatDateTime(e.created_at)}</td>
                    <td>{e.kind}{e.period ? ` ${e.period}` : ''}</td>
                    <td className="break">{e.to_email}</td>
                    <td>{e.status}{e.error ? ` (${e.error})` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
