import { requireAdmin, adminRpc } from '../../../lib/admin';
import { timeAgo } from '../../../lib/time';
import { goUrl } from '../../../lib/env';
import { Flash } from '../../ui/parts';
import { SearchForm, Pager } from '../parts';

export const metadata = { title: 'Plates' };
const LIMIT = 50;

export default async function Plates({ searchParams }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const q = typeof sp.q === 'string' ? sp.q.slice(0, 100) : '';
  const offset = Math.max(0, Number(sp.offset) || 0);
  const list = await adminRpc(supabase, 'admin_list_plates', { p_search: q || null, p_limit: LIMIT, p_offset: offset });

  return (
    <>
      <div className="page-head"><h1>Plates</h1></div>
      <Flash sp={sp} />
      <SearchForm action="/admin/plates" q={q} placeholder="Plate code, location, customer or email" />
      <section className="card">
        {list.rows.length === 0 ? <p className="muted">{q ? 'No plate matches this search.' : 'No plate yet.'}</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Code</th><th>Location</th><th>Customer</th><th className="n">Scans</th><th>Last scan</th><th>Status</th><th>Address in the chip</th></tr></thead>
              <tbody>
                {list.rows.map((p) => (
                  <tr key={p.id}>
                    <td><code>{p.code}</code>{p.label ? <div className="muted">{p.label}</div> : null}</td>
                    <td>{p.business_name}</td>
                    <td><a href={`/admin/customers/${p.company_id}`}>{p.company_name}</a><div className="muted break">{p.owner_email || ''}</div></td>
                    <td className="n"><strong>{Number(p.total_scans).toLocaleString('en-MY')}</strong></td>
                    <td className="nowrap">{p.last_scan_at ? timeAgo(p.last_scan_at) : 'Never'}</td>
                    <td>{p.active ? <span className="badge on">ACTIVE</span> : <span className="badge off">PAUSED</span>}</td>
                    <td><code>{goUrl(p.code, 'nfc')}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager base="/admin/plates" q={q} offset={offset} limit={LIMIT} total={Number(list.total)} />
      </section>
      <p className="muted">To pause, rename, move or delete a plate, open its customer. The QR code uses the same address ending in <code>?qr</code>.</p>
    </>
  );
}
