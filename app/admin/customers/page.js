import { requireAdmin, adminRpc } from '../../../lib/admin';
import { timeAgo } from '../../../lib/time';
import { Flash, PlanBadge } from '../../ui/parts';
import { SearchForm, Pager } from '../parts';

export const metadata = { title: 'Customers' };
const LIMIT = 30;

export default async function Customers({ searchParams }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const q = typeof sp.q === 'string' ? sp.q.slice(0, 100) : '';
  const offset = Math.max(0, Number(sp.offset) || 0);
  const list = await adminRpc(supabase, 'admin_list_customers', { p_search: q || null, p_limit: LIMIT, p_offset: offset });

  return (
    <>
      <div className="page-head">
        <h1>Customers</h1>
        <a className="btn small" href="/admin#new">New customer</a>
      </div>
      <Flash sp={sp} />
      <SearchForm action="/admin/customers" q={q} placeholder="Name, email, location or plate code" />

      <section className="card">
        {list.rows.length === 0 && <p className="muted">{q ? 'No customer matches this search.' : 'No customer yet. Create the first one from the overview.'}</p>}
        {list.rows.map((c) => (
          <div className="plate" key={c.id}>
            <div className="who">
              <strong><a href={`/admin/customers/${c.id}`}>{c.name}</a></strong>
              <span className="muted break">
                {c.owner_email || 'No login email'}{c.owner_email && !c.has_login ? ' (never logged in)' : ''}{c.contact_name ? ` · ${c.contact_name}` : ''}
              </span>
              <div style={{ marginTop: 4 }}>
                {c.businesses.map((b) => (
                  <div key={b.id} className="muted">
                    {b.name} <PlanBadge pro={b.is_pro} /> {b.plates} {Number(b.plates) === 1 ? 'plate' : 'plates'}, {Number(b.total_scans).toLocaleString('en-MY')} scans
                    {b.last_scan_at ? `, last ${timeAgo(b.last_scan_at)}` : ''}
                  </div>
                ))}
                {c.businesses.length === 0 && <span className="muted">No location yet</span>}
              </div>
            </div>
            <a className="btn out small" href={`/admin/customers/${c.id}`}>Open</a>
          </div>
        ))}
        <Pager base="/admin/customers" q={q} offset={offset} limit={LIMIT} total={Number(list.total)} />
      </section>
    </>
  );
}
