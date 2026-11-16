// Charts rendered on the server as plain HTML and CSS: no chart library, no client JavaScript.
// Rules followed: one baseline, thin bars (24px at most) with a rounded data end, hairline grid,
// a legend whenever there are two series, text never in the series colour, a hover / focus
// tooltip on every bar, and a table view under every chart so no value depends on hovering.
import { niceMax, share } from '../../lib/stats';

const SERIES = [
  { key: 'nfc', name: 'NFC taps' },
  { key: 'qr', name: 'QR scans' },
  { key: 'other', name: 'Direct link' },
];

function ticks(max) {
  return [0, max / 4, max / 2, (max * 3) / 4, max].map((v) => (Number.isInteger(v) ? v : Math.round(v * 10) / 10));
}

export function Legend({ showOther = false }) {
  return (
    <p className="legend">
      <span><i className="k-nfc" />NFC taps</span>
      <span><i className="k-qr" />QR scans</span>
      {showOther && <span><i className="k-other" />Direct link</span>}
    </p>
  );
}

/**
 * Column chart of scans over time, stacked by source.
 * points: [{ key, label, title, total, nfc, qr, other, partial? }] — label is the short x label
 * (shown for a few columns only), title the full text used in the tooltip and the table.
 */
export function ColumnChart({ points, caption, unit = 'scans', single = false, labelEvery, firstColumn = 'Period' }) {
  const total = points.reduce((sum, p) => sum + p.total, 0);
  if (!points.length || total === 0) {
    return <div className="empty-chart">No scans in this period yet. They appear here as soon as someone taps or scans your plate.</div>;
  }
  const max = niceMax(points.map((p) => p.total));
  const showOther = !single && points.some((p) => p.other > 0);
  const step = labelEvery || Math.max(1, Math.ceil(points.length / 7));
  return (
    <figure style={{ margin: 0 }}>
      {!single && <Legend showOther={showOther} />}
      <div className="cols" role="img" aria-label={`${caption}. Total ${total} ${unit}. Details in the table below.`}>
        <div className="cols-y" aria-hidden="true">{ticks(max).map((t) => <span key={t}>{t}</span>)}</div>
        <div className="cols-plot">
          {points.map((p, i) => (
            <div
              key={p.key}
              className={`col${p.partial ? ' partial' : ''}${i < points.length * 0.2 ? ' edge-l' : i > points.length * 0.8 ? ' edge-r' : ''}`}
              tabIndex={0}
            >
              <span className="tip" role="tooltip">
                <strong>{p.total}</strong> {p.total === 1 ? unit.replace(/s$/, '') : unit}<br />
                {p.title}{p.partial ? ' (incomplete)' : ''}
                {!single && p.total > 0 && <><br />NFC {p.nfc}, QR {p.qr}{p.other > 0 ? `, direct ${p.other}` : ''}</>}
              </span>
              <span className="bar" style={{ height: `${(p.total / max) * 100}%` }}>
                {single
                  ? (p.total > 0 ? <b style={{ flex: 1 }} /> : null)
                  : SERIES.map((s) => (p[s.key] > 0 ? <b key={s.key} className={s.key} style={{ flex: p[s.key] }} /> : null))}
              </span>
            </div>
          ))}
        </div>
        <div className="cols-x" aria-hidden="true">
          {points.map((p, i) => <span key={p.key}>{i % step === 0 ? p.label : ''}</span>)}
        </div>
      </div>
      {single ? (
        <TableView columns={[firstColumn, 'Scans']} rows={points.map((p) => [p.title, p.total])} />
      ) : (
        <TableView
          columns={[firstColumn, 'Total', 'NFC', 'QR', ...(showOther ? ['Direct'] : [])]}
          rows={points.map((p) => [`${p.title}${p.partial ? ' (incomplete)' : ''}`, p.total, p.nfc, p.qr, ...(showOther ? [p.other] : [])])}
        />
      )}
    </figure>
  );
}

/** Horizontal bars for a small set of categories (hours of the day, weekdays, plates, locations). */
export function HBars({ rows, caption, highlightTop = true, tableHead = ['', 'Scans'] }) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  if (max === 0) return <div className="empty-chart">Nothing to show for this period yet.</div>;
  const total = rows.reduce((sum, r) => sum + r.value, 0);
  return (
    <figure style={{ margin: 0 }}>
      <div className="hbars" role="img" aria-label={`${caption}. Details in the table below.`}>
        {rows.map((r) => (
          <div key={r.key} className={`hrow${highlightTop && r.value === max ? ' peak' : ''}`} tabIndex={0}>
            <span className="name">{r.label}</span>
            <span className="track"><span className="fill" style={{ width: `${(r.value / max) * 100}%` }} /></span>
            <span className="val">{r.value}</span>
            <span className="tip" role="tooltip"><strong>{r.value}</strong> scans · {share(r.value, total)}%<br />{r.title || r.label}</span>
          </div>
        ))}
      </div>
      <TableView columns={[tableHead[0] || 'Category', tableHead[1], 'Share']} rows={rows.map((r) => [r.title || r.label, r.value, `${share(r.value, total)}%`])} />
    </figure>
  );
}

/** One whole split into NFC / QR / direct. The parts are labelled, so colour is never the only cue. */
export function SplitBar({ nfc, qr, other = 0 }) {
  const total = nfc + qr + other;
  if (total === 0) return <div className="empty-chart">No scans in this period yet.</div>;
  const parts = [
    { key: 'nfc', name: 'NFC taps', value: nfc },
    { key: 'qr', name: 'QR scans', value: qr },
    { key: 'other', name: 'Direct link', value: other },
  ].filter((p) => p.value > 0);
  return (
    <figure style={{ margin: 0 }}>
      <div className="splitbar" role="img" aria-label={parts.map((p) => `${p.name} ${p.value} (${share(p.value, total)}%)`).join(', ')}>
        {parts.map((p) => (
          <span key={p.key} className={p.key} style={{ flex: Math.max(p.value, total * 0.04) }} title={`${p.name}: ${p.value}`}>
            {share(p.value, total) >= 12 ? `${share(p.value, total)}%` : ''}
          </span>
        ))}
      </div>
      <table>
        <tbody>
          {parts.map((p) => (
            <tr key={p.key}>
              <td><i className={`key k-${p.key}`} />{p.name}</td>
              <td className="n"><strong>{p.value}</strong></td>
              <td className="n muted">{share(p.value, total)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export function TableView({ columns, rows }) {
  return (
    <details className="tableview">
      <summary>View as table</summary>
      <div className="table-wrap">
        <table>
          <thead><tr>{columns.map((c, i) => <th key={c} className={i ? 'n' : ''}>{c}</th>)}</tr></thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>{row.map((cell, i) => <td key={i} className={i ? 'n' : ''}>{cell}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
