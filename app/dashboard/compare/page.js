import { loadDashboard, plateName } from '../../../lib/dashboard';
import { share } from '../../../lib/stats';
import { formatDay } from '../../../lib/time';
import { Delta, Seg, ProLock, Empty, PlanBadge } from '../../ui/parts';
import { HBars } from '../../ui/charts';

export const metadata = { title: 'Compare' };

const PERIODS = [7, 30, 90];

export default async function Compare({ searchParams }) {
  const sp = await searchParams;
  const data = await loadDashboard();
  const days = PERIODS.includes(Number(sp.days)) ? Number(sp.days) : 30;

  if (data.businesses.length === 0) {
    return (
      <>
        <div className="page-head"><h1>Compare</h1></div>
        <Empty title="No plate is linked to this email yet"><p>Comparison appears once plates are registered with {data.user.email}.</p></Empty>
      </>
    );
  }
  if (data.proBusinesses.length === 0) {
    return (
      <>
        <div className="page-head"><h1>Compare</h1></div>
        <ProLock
          title="Compare your locations and plates."
          text="With Pro, see which location and which plate brings the most scans, and how each one changes over time."
        />
      </>
    );
  }

  const { data: compare, error } = await data.supabase.rpc('scan_compare', { p_days: days });
  if (error) throw new Error(`scan_compare: ${error.message}`);
  const locations = compare.locations;
  const pro = locations.filter((l) => l.is_pro);
  const basic = locations.filter((l) => !l.is_pro);
  const plates = pro.flatMap((l) => l.plates.map((p) => ({ ...p, location: l.name, locationId: l.id })));
  const totalPro = pro.reduce((sum, l) => sum + l.total, 0);
  const range = `${formatDay(compare.start)} to ${formatDay(compare.end, { year: true })}`;
  const single = pro.length === 1 && plates.length <= 1;

  return (
    <>
      <p className="muted"><a href="/dashboard/analytics">Analytics</a> / Compare</p>
      <div className="page-head">
        <div>
          <h1>Compare</h1>
          <p className="muted">{range}, against the {days} days before. Malaysia time.</p>
        </div>
      </div>
      <div className="filters">
        <Seg label="Period" items={PERIODS.map((d) => ({ href: `/dashboard/compare?days=${d}`, text: `${d} days`, active: d === days }))} />
      </div>

      {single && (
        <div className="note" style={{ marginBottom: 16 }}>
          You have one plate on Pro. Comparison becomes useful with a second plate or a second location. <a href="/dashboard/help">Contact us</a> to add one.
        </div>
      )}

      <section className="card" aria-labelledby="locations">
        <h2 id="locations">Locations</h2>
        {pro.length > 1 && (
          <HBars
            caption={`Scans by location, last ${days} days`}
            tableHead={['Location', 'Scans']}
            rows={pro.map((l) => ({ key: l.id, label: l.name.length > 12 ? `${l.name.slice(0, 11)}…` : l.name, title: l.name, value: l.total }))}
          />
        )}
        <div className="table-wrap" style={{ marginTop: pro.length > 1 ? 14 : 0 }}>
          <table>
            <thead><tr><th>Location</th><th className="n">Scans</th><th className="n">Share</th><th className="n">vs before</th><th className="n">NFC</th><th className="n">QR</th></tr></thead>
            <tbody>
              {pro.map((l) => (
                <tr key={l.id}>
                  <td><a href={`/dashboard/analytics?location=${l.id}&days=${days}`}>{l.name}</a></td>
                  <td className="n"><strong>{l.total}</strong></td>
                  <td className="n">{share(l.total, totalPro)}%</td>
                  <td className="n"><Delta current={l.total} previous={l.prev} /></td>
                  <td className="n">{l.nfc}</td>
                  <td className="n">{l.qr}</td>
                </tr>
              ))}
              {basic.map((l) => {
                const b = data.businesses.find((x) => x.id === l.id);
                return (
                  <tr key={l.id}>
                    <td>{l.name} <PlanBadge pro={false} /></td>
                    <td className="n muted" colSpan={5}>
                      {Number(b?.total_scans || 0).toLocaleString('en-MY')} scans in total, all time. <a href={`/dashboard/billing?location=${l.id}`}>Add Pro to compare</a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {plates.length > 0 && (
        <section className="card" aria-labelledby="plates">
          <h2 id="plates">Plates</h2>
          {plates.length > 1 && (
            <HBars
              caption={`Scans by plate, last ${days} days`}
              tableHead={['Plate', 'Scans']}
              rows={[...plates].sort((a, b) => b.total - a.total).map((p) => ({
                key: p.id, label: p.label || p.code, title: `${plateName(p)}, ${p.location}`, value: p.total,
              }))}
            />
          )}
          <div className="table-wrap" style={{ marginTop: plates.length > 1 ? 14 : 0 }}>
            <table>
              <thead><tr><th>Plate</th><th>Location</th><th className="n">Scans</th><th className="n">vs before</th><th className="n">NFC</th><th className="n">QR</th></tr></thead>
              <tbody>
                {[...plates].sort((a, b) => b.total - a.total).map((p) => (
                  <tr key={p.id}>
                    <td><a href={`/dashboard/analytics?location=${p.locationId}&days=${days}&plate=${p.id}`}>{plateName(p)}</a>{!p.active && <> <span className="badge off">PAUSED</span></>}</td>
                    <td>{p.location}</td>
                    <td className="n"><strong>{p.total}</strong></td>
                    <td className="n"><Delta current={p.total} previous={p.prev} /></td>
                    <td className="n">{p.nfc}</td>
                    <td className="n">{p.qr}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
