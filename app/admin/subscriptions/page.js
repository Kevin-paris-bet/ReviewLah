import { requireAdmin, adminRpc } from '../../../lib/admin';
import { formatDate } from '../../../lib/time';
import { PRO_PRICES } from '../../../lib/plans';
import { Flash } from '../../ui/parts';

export const metadata = { title: 'Plans' };

const STATUS = { active: ['ACTIVE', 'on'], trialing: ['TRIAL', 'on'], past_due: ['PAYMENT FAILED', 'wait'], canceled: ['ENDED', 'plain'], incomplete: ['CHECKOUT OPEN', 'plain'] };

export default async function Subscriptions({ searchParams }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const rows = await adminRpc(supabase, 'admin_list_subscriptions', { p_limit: 300 });
  const live = rows.filter((s) => ['active', 'trialing', 'past_due'].includes(s.status));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Plans</h1>
          <p className="muted">{live.length} live Pro {live.length === 1 ? 'subscription' : 'subscriptions'} ({live.filter((s) => s.provider !== 'manual').length} paid, {live.filter((s) => s.provider === 'manual').length} manual). Pro is per location.</p>
        </div>
      </div>
      <Flash sp={sp} />
      <section className="card">
        {rows.length === 0 ? <p className="muted">No subscription yet. Switch Pro on manually from a customer page, or wait for the first online payment.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Location</th><th>Customer</th><th>Status</th><th>Source</th><th>Price</th><th>Period end</th><th>Started</th></tr></thead>
              <tbody>
                {rows.map((s) => {
                  const [label, cls] = STATUS[s.status] || [s.status, 'plain'];
                  return (
                    <tr key={s.id}>
                      <td>{s.business_name}</td>
                      <td><a href={`/admin/customers/${s.company_id}`}>{s.company_name}</a><div className="muted break">{s.owner_email || ''}</div></td>
                      <td><span className={`badge ${cls}`}>{label}</span>{s.cancel_at_period_end && s.status !== 'canceled' ? <div className="muted">Renewal off</div> : null}</td>
                      <td>{s.provider === 'manual' ? 'Manual' : s.provider}</td>
                      <td className="nowrap">{s.provider === 'manual' ? 'Free' : PRO_PRICES[s.billing_interval]?.short || ''}</td>
                      <td className="nowrap">{s.current_period_end ? formatDate(s.current_period_end) : 'No end date'}</td>
                      <td className="nowrap">{formatDate(s.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="muted">To switch Pro on or off manually, or to stop a paid renewal, open the customer.</p>
    </>
  );
}
