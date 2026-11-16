import { notFound } from 'next/navigation';
import { loadDashboard, plateName } from '../../../../lib/dashboard';
import { goUrl } from '../../../../lib/env';
import { timeAgo, formatDate } from '../../../../lib/time';
import { Flash, PlanBadge } from '../../../ui/parts';
import { Submit, CopyButton } from '../../../ui/client';
import { Icon } from '../../../ui/icons';
import { updateReviewUrl, updateBusinessDetails, updatePlateLabel } from '../../actions';

export const metadata = { title: 'Location' };

export default async function Location({ params, searchParams }) {
  const { id } = await params;
  const sp = await searchParams;
  const data = await loadDashboard();
  const b = data.businesses.find((x) => x.id === id);
  if (!b) notFound();

  return (
    <>
      <p className="muted"><a href="/dashboard">Overview</a> / {b.name}</p>
      <div className="page-head">
        <div>
          <h1>{b.name}</h1>
          <PlanBadge pro={b.is_pro} />
        </div>
        {b.is_pro && <a className="btn small" href={`/dashboard/analytics?location=${b.id}`}><Icon name="chart" /> Analytics</a>}
      </div>
      <Flash sp={sp} />

      <section className="card" aria-labelledby="review-link">
        <h2 id="review-link">Google review link</h2>
        <p className="muted" style={{ fontSize: 15 }}>
          Where your {b.plates.length > 1 ? 'plates send' : 'plate sends'} customers. Every customer lands on this same page, whatever they think of their visit.
        </p>
        <p className="break">
          <a href={b.review_url} target="_blank" rel="noopener noreferrer">{b.review_url}</a>
        </p>
        <div className="row" style={{ marginBottom: 16 }}>
          <a className="btn out small" href={b.review_url} target="_blank" rel="noopener noreferrer"><Icon name="external" /> Open this page</a>
          <CopyButton value={b.review_url} label="Copy link" />
        </div>
        <form action={updateReviewUrl}>
          <input type="hidden" name="business_id" value={b.id} />
          <div className="field">
            <label htmlFor="review_url">Change the link</label>
            <input id="review_url" name="review_url" type="url" inputMode="url" required maxLength={600} placeholder="https://g.page/r/…/review" autoComplete="off" />
            <p className="hint">
              In Google Maps, open your business, choose “Ask for reviews” (or “Share review form”) and copy the link.
              Only Google review and Google Maps links are accepted. The change applies at once, without replacing the plate.
            </p>
          </div>
          <Submit>Save new link</Submit>
        </form>
      </section>

      <section className="card" aria-labelledby="plates">
        <h2 id="plates">{b.plates.length > 1 ? `Plates (${b.plates.length})` : 'Your plate'}</h2>
        {b.plates.length === 0 && <p className="muted">No plate registered for this location yet. <a href="/dashboard/help">Contact us</a> to add one.</p>}
        {b.plates.map((p) => (
          <div key={p.id} style={{ borderTop: '1px solid var(--line)', padding: '14px 0' }}>
            <div className="row spread">
              <div>
                <strong>{plateName(p)}</strong>{' '}
                {p.active ? <span className="badge on">ACTIVE</span> : <span className="badge off">PAUSED</span>}
                <div className="muted">
                  {Number(p.total_scans).toLocaleString('en-MY')} scans in total
                  {p.last_scan_at ? `, last one ${timeAgo(p.last_scan_at)}` : ''} · registered {formatDate(p.created_at)}
                </div>
              </div>
            </div>
            {!p.active && <p className="warn" style={{ marginTop: 10 }}>This plate is paused: it does not open your review page. Contact us to switch it back on.</p>}
            <form action={updatePlateLabel} className="inline-form" style={{ marginTop: 10 }}>
              <input type="hidden" name="plate_id" value={p.id} />
              <input type="hidden" name="business_id" value={b.id} />
              <div className="field">
                <label htmlFor={`label-${p.id}`}>Name of this plate</label>
                <input id={`label-${p.id}`} name="label" defaultValue={p.label || ''} maxLength={40} placeholder="Counter, Table 4, Reception…" />
              </div>
              <Submit className="btn out">Save name</Submit>
            </form>
            <details style={{ marginTop: 10 }}>
              <summary className="muted" style={{ cursor: 'pointer' }}>Addresses programmed in this plate</summary>
              <dl className="kv" style={{ marginTop: 8 }}>
                <dt>NFC chip</dt><dd><code>{goUrl(p.code, 'nfc')}</code></dd>
                <dt>QR code</dt><dd><code>{goUrl(p.code, 'qr')}</code></dd>
              </dl>
              <p className="hint">These never change. Opening one counts as a scan.</p>
            </details>
          </div>
        ))}
      </section>

      <section className="card" aria-labelledby="details">
        <h2 id="details">Location details</h2>
        <form action={updateBusinessDetails}>
          <input type="hidden" name="business_id" value={b.id} />
          <div className="grid2">
            <div className="field">
              <label htmlFor="name">Name</label>
              <input id="name" name="name" defaultValue={b.name} required maxLength={100} />
            </div>
            <div className="field">
              <label htmlFor="address">Address or area <span className="muted">(optional)</span></label>
              <input id="address" name="address" defaultValue={b.address || ''} maxLength={200} placeholder="Bangsar, Kuala Lumpur" />
            </div>
          </div>
          <Submit className="btn out">Save details</Submit>
        </form>
      </section>
    </>
  );
}
