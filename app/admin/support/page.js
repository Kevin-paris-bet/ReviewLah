import { requireAdmin } from '../../../lib/admin';
import { formatDateTime } from '../../../lib/time';
import { Flash } from '../../ui/parts';
import { closeSupportRequest } from '../actions';

export const metadata = { title: 'Support' };

export default async function Support({ searchParams }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const showClosed = sp.show === 'closed';
  const { data, error } = await supabase.from('support_requests')
    .select('id,email,company_id,topic,message,status,created_at')
    .eq('status', showClosed ? 'closed' : 'open').order('created_at', { ascending: false }).limit(100);
  if (error) throw new Error(`support_requests: ${error.message}`);
  const rows = data || [];

  return (
    <>
      <div className="page-head">
        <h1>Support</h1>
        <a className="btn out small" href={showClosed ? '/admin/support' : '/admin/support?show=closed'}>{showClosed ? 'Show open requests' : 'Show closed requests'}</a>
      </div>
      <Flash sp={sp} />
      <section className="card">
        {rows.length === 0 && <p className="muted">{showClosed ? 'No closed request.' : 'No open request. Messages sent from the dashboard help page appear here.'}</p>}
        {rows.map((r) => (
          <div className="review" key={r.id}>
            <div className="row spread">
              <div>
                <strong>{r.topic}</strong>
                <div className="muted break">
                  {r.email} · {formatDateTime(r.created_at)}
                  {r.company_id && <> · <a href={`/admin/customers/${r.company_id}`}>Open customer</a></>}
                </div>
              </div>
              <div className="row">
                {r.email && <a className="btn out small" href={`mailto:${r.email}?subject=${encodeURIComponent(`Re: ${r.topic} (ReviewLah)`)}`}>Reply by email</a>}
                <form action={closeSupportRequest}>
                  <input type="hidden" name="id" value={r.id} />
                  {showClosed && <input type="hidden" name="reopen" value="1" />}
                  <button className="btn small" type="submit">{showClosed ? 'Reopen' : 'Mark as done'}</button>
                </form>
              </div>
            </div>
            <div className="quote">{r.message}</div>
          </div>
        ))}
      </section>
    </>
  );
}
