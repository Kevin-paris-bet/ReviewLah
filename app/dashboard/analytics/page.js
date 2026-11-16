import { loadDashboard, pickBusiness, plateName } from '../../../lib/dashboard';
import { groupWeekly, peakHour, peakWeekday, dayParts, dailyAverage, bestDay, share } from '../../../lib/stats';
import { formatDay, formatMonth, weekdayName, hourLabel, addDays } from '../../../lib/time';
import { Flash, Delta, Seg, ProLock, Empty, Stat } from '../../ui/parts';
import { ColumnChart, HBars, SplitBar } from '../../ui/charts';
import { SelectNav } from '../../ui/client';
import { Icon } from '../../ui/icons';

export const metadata = { title: 'Analytics' };

const PERIODS = [7, 30, 90];

function href(base, changes) {
  const params = new URLSearchParams(base);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === undefined || value === '') params.delete(key);
    else params.set(key, String(value));
  }
  return `/dashboard/analytics?${params.toString()}`;
}

export default async function Analytics({ searchParams }) {
  const sp = await searchParams;
  const data = await loadDashboard();
  if (data.businesses.length === 0) {
    return (
      <>
        <div className="page-head"><h1>Analytics</h1></div>
        <Empty title="No plate is linked to this email yet"><p>Analytics appear once a plate is registered with {data.user.email}.</p></Empty>
      </>
    );
  }
  const b = pickBusiness(data, sp.location, { wantPro: true });
  const days = PERIODS.includes(Number(sp.days)) ? Number(sp.days) : 30;
  const by = ['day', 'week', 'month'].includes(sp.by) ? sp.by : days === 90 ? 'week' : 'day';
  const plate = b.plates.find((p) => p.id === sp.plate) || null;
  const base = { location: b.id, days: String(days), ...(sp.by ? { by } : {}), ...(plate ? { plate: plate.id } : {}) };

  const locationPicker = data.businesses.length > 1 && (
    <SelectNav
      name="location"
      label="Location"
      value={b.id}
      params={{ days: String(days) }}
      options={data.businesses.map((x) => ({ value: x.id, text: `${x.name}${x.is_pro ? '' : ' (Basic)'}` }))}
    />
  );

  if (!b.is_pro) {
    return (
      <>
        <div className="page-head"><h1>Analytics</h1></div>
        {locationPicker && <div className="filters">{locationPicker}</div>}
        <div className="card">
          <span className="muted">Total scans, all time · {b.name}</span>
          <span className="num hero-num">{Number(b.total_scans).toLocaleString('en-MY')}</span>
          <span className="muted">Included with your plate.</span>
        </div>
        <ProLock
          businessId={b.id}
          title="See when and how your plate is used."
          text="Pro shows scans by day, week and month, NFC taps compared with QR scans, your busiest hours and days, and how each plate performs."
        />
      </>
    );
  }

  const { data: stats, error } = await data.supabase.rpc('scan_stats', { p_business_id: b.id, p_days: days, p_plate_id: plate?.id ?? null });
  if (error) throw new Error(`scan_stats: ${error.message}`);

  const range = `${formatDay(stats.start)} to ${formatDay(stats.end, { year: true })}`;
  const prevRange = `${formatDay(stats.prev_start)} to ${formatDay(stats.prev_end)}`;
  let points;
  let chartTitle;
  if (by === 'month') {
    chartTitle = 'Scans per month, last 12 months';
    points = stats.monthly.map((m) => ({ key: m.m, label: formatMonth(m.m).slice(0, 3), title: formatMonth(m.m, { long: true }), ...m }));
  } else if (by === 'week') {
    chartTitle = `Scans per week, ${range}`;
    points = groupWeekly(stats.daily).map((w) => ({
      key: w.start, label: w.label, title: `Week of ${formatDay(w.start)} to ${formatDay(addDays(w.start, 6))}`, ...w,
    }));
  } else {
    chartTitle = `Scans per day, ${range}`;
    points = stats.daily.map((d) => ({ key: d.d, label: formatDay(d.d), title: formatDay(d.d, { weekday: true }), ...d }));
  }
  const hour = peakHour(stats.hours);
  const weekday = peakWeekday(stats.weekdays);
  const best = bestDay(stats.daily);
  const average = dailyAverage(stats.daily);
  const parts = dayParts(stats.hours);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Analytics</h1>
          <p className="muted">{b.name}{plate ? `, ${plateName(plate)}` : ''}. Times are in Malaysia time. A scan is not a review.</p>
        </div>
        <a className="btn out small" href={`/dashboard/export?location=${b.id}&days=${days}`}><Icon name="download" /> Export CSV</a>
      </div>
      <Flash sp={sp} />

      <div className="filters">
        <Seg label="Period" items={PERIODS.map((d) => ({ href: href(base, { days: d, by: null }), text: `${d} days`, active: d === days }))} />
        {locationPicker}
        {b.plates.length > 1 && (
          <SelectNav
            name="plate"
            label="Plate"
            value={plate?.id || ''}
            params={{ location: b.id, days: String(days), ...(sp.by ? { by } : {}) }}
            options={[{ value: '', text: 'All plates' }, ...b.plates.map((p) => ({ value: p.id, text: plateName(p) }))]}
          />
        )}
      </div>

      <div className="stats">
        <Stat label={`Scans, last ${days} days`} value={stats.total.toLocaleString('en-MY')}>
          <span className="sub"><Delta current={stats.total} previous={stats.prev.total} /> vs {stats.prev.total} ({prevRange})</span>
        </Stat>
        <Stat label="Average per day" value={average} sub={best ? `Best day: ${formatDay(best.d, { weekday: true })} (${best.total})` : 'No scans yet'} />
        <Stat label="NFC taps" value={stats.nfc.toLocaleString('en-MY')}>
          <span className="sub"><Delta current={stats.nfc} previous={stats.prev.nfc} /> {share(stats.nfc, stats.total)}% of scans</span>
        </Stat>
        <Stat label="QR scans" value={stats.qr.toLocaleString('en-MY')}>
          <span className="sub"><Delta current={stats.qr} previous={stats.prev.qr} /> {share(stats.qr, stats.total)}% of scans</span>
        </Stat>
      </div>

      <section className="card" style={{ marginTop: 16 }} aria-labelledby="over-time">
        <div className="card-head">
          <h2 id="over-time">{chartTitle}</h2>
          <Seg label="Group by" items={['day', 'week', 'month'].map((g) => ({ href: href(base, { by: g }), text: g[0].toUpperCase() + g.slice(1), active: g === by }))} />
        </div>
        <ColumnChart points={points} caption={chartTitle} firstColumn={by === 'day' ? 'Day' : by === 'week' ? 'Week' : 'Month'} />
        {by === 'week' && points.some((p) => p.partial) && <p className="hint">Lighter bars are weeks cut by the start or the end of the period.</p>}
      </section>

      <div className="grid2">
        <section className="card" aria-labelledby="split">
          <h2 id="split">NFC taps and QR scans</h2>
          <p className="muted">How customers opened your review page, {range}.</p>
          <SplitBar nfc={stats.nfc} qr={stats.qr} other={stats.other} />
          {stats.other > 0 && <p className="hint">Direct link: the plate address was opened without tapping or scanning (for example typed or shared).</p>}
        </section>

        <section className="card" aria-labelledby="weekdays">
          <h2 id="weekdays">Busiest days of the week</h2>
          <p className="muted">{weekday ? `${weekday.name} is your busiest day (${weekday.count} scans).` : 'No scans in this period yet.'}</p>
          <HBars
            caption="Scans by day of the week"
            tableHead={['Day', 'Scans']}
            rows={stats.weekdays.map((value, i) => ({ key: i, label: weekdayName(i + 1, true), title: weekdayName(i + 1), value }))}
          />
        </section>
      </div>

      <section className="card" aria-labelledby="hours">
        <h2 id="hours">Busiest hours</h2>
        <p className="muted">
          {hour ? `Your busiest hour is ${hour.label} (${hour.count} scans). Keep the plate visible and easy to reach at that time.` : 'No scans in this period yet.'}
        </p>
        <ColumnChart
          single
          labelEvery={3}
          firstColumn="Hour"
          caption="Scans by hour of the day, Malaysia time"
          points={stats.hours.map((total, h) => ({ key: h, label: hourLabel(h), title: `${hourLabel(h)} to ${hourLabel(h + 1)}`, total }))}
        />
        <div style={{ marginTop: 18 }}>
          <HBars
            caption="Scans by part of the day"
            highlightTop
            tableHead={['Part of the day', 'Scans']}
            rows={parts.map((p) => ({ key: p.key, label: p.label, title: `${p.label} (${p.range})`, value: p.count }))}
          />
        </div>
      </section>

      {stats.plates.length > 1 && (
        <section className="card" aria-labelledby="by-plate">
          <div className="card-head">
            <h2 id="by-plate">By plate, last {days} days</h2>
            <a className="btn quiet small" href={`/dashboard/compare?days=${days}`}>Compare everything</a>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Plate</th><th className="n">Scans</th><th className="n">Share</th><th className="n">vs before</th><th className="n">NFC</th><th className="n">QR</th></tr></thead>
              <tbody>
                {stats.plates.map((p) => {
                  const all = stats.plates.reduce((sum, x) => sum + x.total, 0);
                  return (
                    <tr key={p.id}>
                      <td><a href={href(base, { plate: p.id })}>{plateName(p)}</a>{!p.active && <> <span className="badge off">PAUSED</span></>}</td>
                      <td className="n"><strong>{p.total}</strong></td>
                      <td className="n">{share(p.total, all)}%</td>
                      <td className="n"><Delta current={p.total} previous={p.prev} /></td>
                      <td className="n">{p.nfc}</td>
                      <td className="n">{p.qr}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
