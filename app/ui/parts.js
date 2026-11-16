// Small server-rendered building blocks shared by the dashboard and the admin.
import { okMessage, errorMessage } from '../../lib/messages';
import { trend } from '../../lib/stats';
import { PRO_PRICES } from '../../lib/plans';
import { Icon } from './icons';

/** Confirmation / error banner driven by ?ok=… or ?error=… */
export function Flash({ sp }) {
  const ok = okMessage(sp?.ok);
  const error = errorMessage(sp?.error);
  return (
    <>
      {ok && <div className="ok" role="status">{ok}</div>}
      {error && <div className="err" role="alert">{error}</div>}
    </>
  );
}

export function PlanBadge({ pro }) {
  return <span className={`badge ${pro ? 'pro' : ''}`}>{pro ? 'PRO' : 'BASIC'}</span>;
}

/** "+12%" pill comparing a figure with the previous period. Colour is doubled by an arrow and text. */
export function Delta({ current, previous, label }) {
  const t = trend(current, previous);
  const arrow = t.direction === 'up' ? '↑' : t.direction === 'down' ? '↓' : '';
  const cls = t.direction === 'up' ? 'up' : t.direction === 'down' ? 'down' : '';
  return (
    <span className={`delta ${cls}`}>
      {arrow && <span aria-hidden="true">{arrow}</span>}
      {t.text}
      {label && <span className="sr"> {label}</span>}
    </span>
  );
}

export function Stat({ label, value, sub, children }) {
  return (
    <div className="stat">
      <span className="label">{label}</span>
      <span className="num">{value}</span>
      {sub && <span className="sub">{sub}</span>}
      {children}
    </div>
  );
}

/** Segmented control made of links (works without JavaScript). */
export function Seg({ items, label }) {
  return (
    <nav className="seg" aria-label={label}>
      {items.map((item) => (
        <a key={item.href} href={item.href} aria-current={item.active ? 'true' : undefined}>{item.text}</a>
      ))}
    </nav>
  );
}

/** Shown in place of a Pro screen for a Basic location. Honest: says what Pro adds and what stays. */
export function ProLock({ title, text, businessId }) {
  return (
    <div className="card blue">
      <span className="badge">OPTIONAL PRO</span>
      <h2 style={{ marginTop: 10 }}>{title}</h2>
      <p className="muted" style={{ fontSize: 15 }}>{text}</p>
      <p className="muted">
        {PRO_PRICES.month.short} or {PRO_PRICES.year.short} per location. Cancel renewal anytime: your plate and your Basic dashboard keep working.
      </p>
      <a className="btn" href={`/dashboard/billing${businessId ? `?location=${businessId}` : ''}`}>See Pro <Icon name="arrow" /></a>
    </div>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="card">
      <h2>{title}</h2>
      <div className="muted" style={{ fontSize: 15 }}>{children}</div>
    </div>
  );
}

/** Two-step confirmation without JavaScript: the real button only appears once the panel is opened. */
export function Confirm({ summary, children, danger = true }) {
  return (
    <details>
      <summary className={`btn small ${danger ? 'danger' : 'out'}`} style={{ display: 'inline-flex', listStyle: 'none' }}>{summary}</summary>
      <div className="note" style={{ marginTop: 10 }}>{children}</div>
    </details>
  );
}

export function Stars({ rating }) {
  const n = Math.max(0, Math.min(5, Number(rating) || 0));
  return (
    <span className="stars" role="img" aria-label={`${n} out of 5 stars`}>
      {'★'.repeat(n)}<i>{'★'.repeat(5 - n)}</i>
    </span>
  );
}
