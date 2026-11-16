import { loadDashboard, plateName } from '../../lib/dashboard';
import { timeAgo, formatDate } from '../../lib/time';
import { PRO_FEATURES, PRO_PRICES } from '../../lib/plans';
import { Flash, PlanBadge, Delta, Empty } from '../ui/parts';
import { Icon } from '../ui/icons';

export const metadata = { title: 'Overview' };

function NoPlates({ email }) {
  return (
    <Empty title="No plate is linked to this email yet">
      <p>You are logged in as <strong>{email}</strong>. Your dashboard appears as soon as a plate is registered with this address.</p>
      <p>Ordered with another email? Log out and log in with that one. Otherwise, <a href="/dashboard/help">contact us</a> and we link your plate.</p>
    </Empty>
  );
}

export default async function Overview({ searchParams }) {
  const sp = await searchParams;
  const data = await loadDashboard();
  const { businesses } = data;
  const basic = businesses.filter((b) => !b.is_pro);
  const many = businesses.length > 1;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Your business, at a glance.</h1>
          <p className="muted">A scan means someone tapped or scanned your plate. It does not prove that a review was posted.</p>
        </div>
      </div>
      <Flash sp={sp} />

      {businesses.length === 0 && <NoPlates email={data.user.email} />}

      {businesses.length > 0 && (
        <div className="card">
          <span className="muted">Total scans, all time{many ? ', all locations' : ''}</span>
          <span className="num hero-num">{data.totalScans.toLocaleString('en-MY')}</span>
          <span className="muted">
            {data.lastScanAt ? `Last scan ${timeAgo(data.lastScanAt)}.` : 'No scan yet. Place your plate where customers pay or wait.'}
            {many ? ` ${businesses.length} locations, ${data.plates.length} plates.` : data.plates.length > 1 ? ` ${data.plates.length} plates.` : ''}
          </span>
        </div>
      )}

      {businesses.map((b) => (
        <section className="card" key={b.id} aria-label={b.name}>
          <div className="card-head">
            <div>
              <h2>{b.name}</h2>
              <PlanBadge pro={b.is_pro} />
              {b.address && <span className="muted"> {b.address}</span>}
            </div>
            <a className="btn out small" href={`/dashboard/locations/${b.id}`}>Manage</a>
          </div>

          <div className={`stats ${b.is_pro ? 'three' : 'two'}`}>
            <div className="stat">
              <span className="label">Total scans, all time</span>
              <span className="num">{Number(b.total_scans).toLocaleString('en-MY')}</span>
              <span className="sub">{b.last_scan_at ? `Last scan ${timeAgo(b.last_scan_at)}` : 'No scan yet'}</span>
            </div>
            {b.is_pro && b.recent && (
              <>
                <div className="stat">
                  <span className="label">Last 7 days</span>
                  <span className="num">{b.recent.d7}</span>
                  <span className="sub"><Delta current={b.recent.d7} previous={b.recent.d7_prev} /> vs the 7 days before</span>
                </div>
                <div className="stat">
                  <span className="label">Last 30 days</span>
                  <span className="num">{b.recent.d30}</span>
                  <span className="sub"><Delta current={b.recent.d30} previous={b.recent.d30_prev} /> vs the 30 days before</span>
                </div>
              </>
            )}
            {!b.is_pro && (
              <div className="stat">
                <span className="label">Plates</span>
                <span className="num">{b.plates.length}</span>
                <span className="sub">{b.plates.filter((p) => p.active).length} active</span>
              </div>
            )}
          </div>

          <div style={{ marginTop: 14 }}>
            {b.plates.map((p) => (
              <div className="plate" key={p.id}>
                <div className="who">
                  <strong>{plateName(p)}</strong>
                  <span className="muted">
                    {!p.active && <span className="badge off">PAUSED</span>}{' '}
                    {p.last_scan_at ? `Last scan ${timeAgo(p.last_scan_at)}` : `Registered ${formatDate(p.created_at)}`}
                  </span>
                </div>
                <div className="count">
                  <span className="num">{Number(p.total_scans).toLocaleString('en-MY')}</span>
                  <span className="muted">scans</span>
                </div>
              </div>
            ))}
            {b.plates.length === 0 && <p className="muted">No plate registered for this location yet.</p>}
          </div>

          {b.is_pro ? (
            <div className="row" style={{ marginTop: 12 }}>
              <a className="btn small" href={`/dashboard/analytics?location=${b.id}`}><Icon name="chart" /> View analytics</a>
              <a className="btn out small" href={`/dashboard/links?location=${b.id}`}><Icon name="link" /> Links page</a>
            </div>
          ) : null}
        </section>
      ))}

      {basic.length > 0 && (
        <section className="card blue" aria-label="ReviewLah Pro">
          <span className="badge">OPTIONAL PRO</span>
          <h2 style={{ marginTop: 10 }}>Want to see what is behind the scans?</h2>
          <ul className="checks">
            {PRO_FEATURES.slice(0, 4).map((f) => <li key={f}>{f}</li>)}
          </ul>
          <p className="muted">
            {PRO_PRICES.month.short} or {PRO_PRICES.year.short} per location. Your plate works the same with or without it.
          </p>
          <a className="btn out small" href="/dashboard/billing">See what Pro adds</a>
        </section>
      )}
    </>
  );
}
