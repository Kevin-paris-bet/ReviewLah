import { requireAdmin, adminRpc } from '../../lib/admin';
import { Flash, Stat } from '../ui/parts';
import { BundleForm } from './parts';

export const metadata = { title: 'Overview' };

export default async function AdminHome({ searchParams }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const o = await adminRpc(supabase, 'admin_overview');
  const n = (v) => Number(v || 0).toLocaleString('en-MY');

  return (
    <>
      <div className="page-head"><h1>Overview</h1></div>
      <Flash sp={sp} />

      <div className="stats">
        <Stat label="Customers" value={n(o.companies)} sub={`${n(o.businesses)} locations`} />
        <Stat label="Plates" value={n(o.plates)} sub={`${n(o.plates_active)} active`} />
        <Stat label="Pro locations" value={n(o.pro_locations)} sub={`${n(o.pro_paid)} paid${Number(o.past_due) ? `, ${n(o.past_due)} payment failed` : ''}`} />
        <Stat label="Scans today" value={n(o.scans_today)} sub={`${n(o.scans_7d)} in 7 days, ${n(o.scans_30d)} in 30 days`} />
      </div>
      <p className="muted" style={{ marginTop: 10 }}>
        {n(o.scans_total)} scans in total. Days are counted in Malaysia time.
        {Number(o.open_support) > 0 && <> <a href="/admin/support">{n(o.open_support)} open support {Number(o.open_support) === 1 ? 'request' : 'requests'}</a>.</>}
      </p>

      <section className="card" style={{ marginTop: 16 }} aria-labelledby="new">
        <h2 id="new">New customer, location and plates</h2>
        <p className="muted" style={{ fontSize: 15 }}>One form creates everything. The plate codes and the addresses to program appear on the next page.</p>
        <BundleForm />
      </section>
    </>
  );
}
