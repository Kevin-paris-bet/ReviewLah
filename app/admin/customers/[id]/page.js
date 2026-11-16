import { notFound } from 'next/navigation';
import { requireAdmin, adminRpc } from '../../../../lib/admin';
import { isUuid } from '../../../../lib/validation';
import { formatDate, formatDateTime, timeAgo } from '../../../../lib/time';
import { PRO_PRICES, formatMoney } from '../../../../lib/plans';
import { siteUrl } from '../../../../lib/env';
import { Flash, PlanBadge, Confirm } from '../../../ui/parts';
import { Submit } from '../../../ui/client';
import { BundleForm, PlateAddresses } from '../../parts';
import { updateCompany, setCompanyEmail, updateLocation, setPro, manageSubscription, addPlates, updatePlate, sendTestSummary } from '../../actions';

export const metadata = { title: 'Customer' };

const AUDIT = {
  'review_url.updated': 'Review link changed',
  'pro.manual': 'Pro switched manually',
  'bundle.created': 'Location and plates created',
  'company.email': 'Login email changed',
  'subscription.cancel_scheduled': 'Renewal cancelled',
  'subscription.cancel_undone': 'Renewal resumed',
  'subscription.superseded': 'Subscription replaced',
  'plate.moved': 'Plate moved',
  'plate.deleted': 'Plate deleted',
};

function Plan({ company, b }) {
  const live = b.subscriptions.find((s) => ['trialing', 'active', 'past_due'].includes(s.status));
  const hidden = (
    <>
      <input type="hidden" name="company_id" value={company.id} />
      <input type="hidden" name="business_id" value={b.id} />
    </>
  );
  if (live && live.provider !== 'manual') {
    return (
      <div className="note">
        <strong>Paid Pro ({live.provider}{live.billing_interval ? `, ${PRO_PRICES[live.billing_interval]?.short}` : ''}).</strong>{' '}
        {live.status === 'past_due' ? 'Last payment failed, retries in progress. ' : ''}
        {live.current_period_end ? `${live.cancel_at_period_end ? 'Ends' : 'Renews'} on ${formatDate(live.current_period_end)}.` : ''}
        <div className="row" style={{ marginTop: 10 }}>
          <form action={manageSubscription}>
            <input type="hidden" name="company_id" value={company.id} />
            <input type="hidden" name="subscription_id" value={live.id} />
            <input type="hidden" name="mode" value={live.cancel_at_period_end ? 'resume' : 'cancel'} />
            <Submit className="btn out small">{live.cancel_at_period_end ? 'Resume renewal' : 'Cancel renewal'}</Submit>
          </form>
          <Confirm summary="End now">
            <p>Ends the subscription at the payment provider immediately, without refund. Pro switches off when the provider confirms. The plate keeps working.</p>
            <form action={manageSubscription}>
              <input type="hidden" name="company_id" value={company.id} />
              <input type="hidden" name="subscription_id" value={live.id} />
              <input type="hidden" name="mode" value="end" />
              <Submit className="btn danger small">Yes, end the subscription now</Submit>
            </form>
          </Confirm>
        </div>
      </div>
    );
  }
  if (live) {
    return (
      <div className="note">
        <strong>Manual Pro.</strong> {live.current_period_end ? `Until ${formatDate(live.current_period_end)}.` : 'No end date.'} Nothing is charged.
        <div className="row" style={{ marginTop: 10, alignItems: 'flex-end' }}>
          <form action={setPro} className="inline-form">
            {hidden}
            <input type="hidden" name="enabled" value="true" />
            <div className="field">
              <label htmlFor={`until-${b.id}`}>Change end date <span className="muted">(empty = no end)</span></label>
              <input id={`until-${b.id}`} name="until" type="date" />
            </div>
            <Submit className="btn out small">Save date</Submit>
          </form>
          <form action={setPro}>
            {hidden}
            <input type="hidden" name="enabled" value="false" />
            <Submit className="btn danger small">Switch Pro off</Submit>
          </form>
        </div>
      </div>
    );
  }
  return (
    <form action={setPro} className="inline-form">
      {hidden}
      <input type="hidden" name="enabled" value="true" />
      <div className="field">
        <label htmlFor={`until-${b.id}`}>Switch Pro on manually, until <span className="muted">(empty = no end)</span></label>
        <input id={`until-${b.id}`} name="until" type="date" />
      </div>
      <Submit className="btn small">Switch Pro on</Submit>
    </form>
  );
}

export default async function Customer({ params, searchParams }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  const { supabase } = await requireAdmin();
  const data = await adminRpc(supabase, 'admin_get_customer', { p_company_id: id });
  if (!data) notFound();
  const { company, businesses, payments, support, audit } = data;
  const created = typeof sp.new === 'string' ? sp.new.split(',').filter((c) => /^[A-Z0-9]{3,16}$/.test(c)).slice(0, 50) : [];
  const nameOf = (businessId) => businesses.find((b) => b.id === businessId)?.name || '';

  return (
    <>
      <p className="muted"><a href="/admin/customers">Customers</a> / {company.name}</p>
      <div className="page-head">
        <div>
          <h1>{company.name}</h1>
          <p className="muted break">
            {company.owner_email || 'No login email'} · {company.has_login ? 'has logged in' : 'never logged in'} · customer since {formatDate(company.created_at)}
          </p>
        </div>
      </div>
      <Flash sp={sp} />
      {sp.detail && sp.error && <div className="err" role="alert">{String(sp.detail).slice(0, 300)}</div>}

      {created.length > 0 && (
        <section className="card blue" aria-label="Plates just created">
          <h2>{created.length === 1 ? 'Plate created' : `${created.length} plates created`}: program these addresses</h2>
          {created.map((code) => (
            <div key={code} style={{ marginBottom: 6 }}>
              <strong>Plate {code}</strong>
              <PlateAddresses code={code} />
            </div>
          ))}
          <p className="muted" style={{ margin: 0 }}>Test each plate before dispatch: tap it, scan it, and check that the right Google page opens.</p>
        </section>
      )}

      {businesses.map((b) => (
        <section className="card" key={b.id} aria-label={b.name}>
          <div className="card-head">
            <div>
              <h2>{b.name}</h2>
              <PlanBadge pro={b.is_pro} /> <span className="muted">{b.address || ''}</span>
            </div>
            <a className="btn quiet small" href={`${siteUrl()}/l/${b.slug}`} target="_blank" rel="noopener noreferrer">Links page</a>
          </div>

          <Plan company={company} b={b} />

          <h3 style={{ marginTop: 18 }}>Plates ({b.plates.length})</h3>
          {b.plates.length === 0 && <p className="muted">No plate yet.</p>}
          {b.plates.map((p) => (
            <div key={p.id} style={{ borderTop: '1px solid var(--line)', padding: '12px 0' }}>
              <div className="row spread">
                <div>
                  <strong><code>{p.code}</code>{p.label ? ` ${p.label}` : ''}</strong>{' '}
                  {p.active ? <span className="badge on">ACTIVE</span> : <span className="badge off">PAUSED</span>}
                  <div className="muted">
                    {Number(p.total_scans).toLocaleString('en-MY')} scans{p.last_scan_at ? `, last ${timeAgo(p.last_scan_at)}` : ''} · created {formatDate(p.created_at)}
                  </div>
                </div>
                <form action={updatePlate}>
                  <input type="hidden" name="company_id" value={company.id} />
                  <input type="hidden" name="plate_id" value={p.id} />
                  <input type="hidden" name="mode" value={p.active ? 'pause' : 'resume'} />
                  <Submit className="btn out small">{p.active ? 'Pause' : 'Activate'}</Submit>
                </form>
              </div>
              <details style={{ marginTop: 8 }}>
                <summary className="muted" style={{ cursor: 'pointer' }}>Addresses, name, move, delete</summary>
                <PlateAddresses code={p.code} />
                <form action={updatePlate} className="inline-form" style={{ marginTop: 8 }}>
                  <input type="hidden" name="company_id" value={company.id} />
                  <input type="hidden" name="plate_id" value={p.id} />
                  <input type="hidden" name="mode" value="label" />
                  <div className="field">
                    <label htmlFor={`label-${p.id}`}>Plate name</label>
                    <input id={`label-${p.id}`} name="label" defaultValue={p.label || ''} maxLength={40} />
                  </div>
                  <Submit className="btn out small">Save name</Submit>
                </form>
                {businesses.length > 1 && (
                  <form action={updatePlate} className="inline-form" style={{ marginTop: 8 }}>
                    <input type="hidden" name="company_id" value={company.id} />
                    <input type="hidden" name="plate_id" value={p.id} />
                    <input type="hidden" name="mode" value="move" />
                    <div className="field">
                      <label htmlFor={`move-${p.id}`}>Move to another location <span className="muted">(keeps its code and scans, takes the new review link)</span></label>
                      <select id={`move-${p.id}`} name="target_business_id" defaultValue="">
                        <option value="" disabled>Choose a location</option>
                        {businesses.filter((x) => x.id !== b.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                      </select>
                    </div>
                    <Submit className="btn out small">Move</Submit>
                  </form>
                )}
                {Number(p.total_scans) === 0 && (
                  <div style={{ marginTop: 8 }}>
                    <Confirm summary="Delete this plate">
                      <p>Only for a plate created by mistake. A plate that has been scanned cannot be deleted: pause it instead.</p>
                      <form action={updatePlate}>
                        <input type="hidden" name="company_id" value={company.id} />
                        <input type="hidden" name="plate_id" value={p.id} />
                        <input type="hidden" name="mode" value="delete" />
                        <Submit className="btn danger small">Yes, delete plate {p.code}</Submit>
                      </form>
                    </Confirm>
                  </div>
                )}
              </details>
            </div>
          ))}
          <form action={addPlates} className="inline-form" style={{ marginTop: 10 }}>
            <input type="hidden" name="company_id" value={company.id} />
            <input type="hidden" name="business_id" value={b.id} />
            <div className="field" style={{ maxWidth: 140 }}>
              <label htmlFor={`count-${b.id}`}>Add plates</label>
              <input id={`count-${b.id}`} name="count" type="number" inputMode="numeric" min={1} max={50} defaultValue={1} />
            </div>
            <div className="field">
              <label htmlFor={`newlabel-${b.id}`}>Name <span className="muted">(optional)</span></label>
              <input id={`newlabel-${b.id}`} name="label" maxLength={40} />
            </div>
            <Submit className="btn out small" pending="Creating…">Add</Submit>
          </form>

          <details style={{ marginTop: 16 }}>
            <summary className="linkbtn" style={{ listStyle: 'none' }}>Edit location and review link</summary>
            <form action={updateLocation} style={{ marginTop: 12 }}>
              <input type="hidden" name="company_id" value={company.id} />
              <input type="hidden" name="business_id" value={b.id} />
              <input type="hidden" name="current_review_url" value={b.review_url || ''} />
              <div className="grid2">
                <div className="field">
                  <label htmlFor={`name-${b.id}`}>Location name</label>
                  <input id={`name-${b.id}`} name="name" defaultValue={b.name} required maxLength={100} />
                </div>
                <div className="field">
                  <label htmlFor={`address-${b.id}`}>Address or area</label>
                  <input id={`address-${b.id}`} name="address" defaultValue={b.address || ''} maxLength={200} />
                </div>
              </div>
              <div className="field">
                <label htmlFor={`url-${b.id}`}>Google review link <span className="muted">(applies to every plate of this location)</span></label>
                <input id={`url-${b.id}`} name="review_url" type="url" defaultValue={b.review_url || ''} required maxLength={600} />
              </div>
              <Submit className="btn out small">Save location</Submit>
            </form>
          </details>
        </section>
      ))}

      <section className="card" aria-labelledby="add-location">
        <details open={businesses.length === 0}>
          <summary><h2 id="add-location" style={{ display: 'inline' }}>Add a location</h2></summary>
          <div style={{ marginTop: 12 }}><BundleForm company={company} /></div>
        </details>
      </section>

      <section className="card" aria-labelledby="details">
        <h2 id="details">Customer details</h2>
        <form action={updateCompany}>
          <input type="hidden" name="company_id" value={company.id} />
          <div className="grid2">
            <div className="field"><label htmlFor="name">Company name</label><input id="name" name="name" defaultValue={company.name} required maxLength={100} /></div>
            <div className="field"><label htmlFor="contact_name">Contact name</label><input id="contact_name" name="contact_name" defaultValue={company.contact_name || ''} maxLength={100} /></div>
            <div className="field"><label htmlFor="phone">Phone</label><input id="phone" name="phone" type="tel" defaultValue={company.phone || ''} maxLength={30} /></div>
            <div className="field"><label htmlFor="whatsapp">WhatsApp</label><input id="whatsapp" name="whatsapp" type="tel" defaultValue={company.whatsapp || ''} maxLength={30} /></div>
          </div>
          <div className="field">
            <label htmlFor="admin_notes">Internal notes <span className="muted">(never shown to the customer)</span></label>
            <textarea id="admin_notes" name="admin_notes" defaultValue={company.admin_notes || ''} maxLength={2000} style={{ minHeight: 80 }} />
          </div>
          <Submit className="btn out small">Save details</Submit>
        </form>
        <hr className="divider" />
        <form action={setCompanyEmail} className="inline-form">
          <input type="hidden" name="company_id" value={company.id} />
          <div className="field">
            <label htmlFor="email">Login email</label>
            <input id="email" name="email" type="email" defaultValue={company.owner_email || ''} maxLength={254} />
          </div>
          <Submit className="btn out small">Change login email</Submit>
        </form>
        <p className="hint">The customer logs in with this address (login link by email). Changing it detaches the previous login.</p>
        <hr className="divider" />
        <form action={sendTestSummary}>
          <input type="hidden" name="company_id" value={company.id} />
          <Submit className="btn out small" pending="Sending…">Send me last month&apos;s summary of this customer (test)</Submit>
        </form>
        <p className="hint">Goes to your own inbox only. The customer receives the real one on the 1st of the month, if a location is Pro.</p>
      </section>

      <section className="card" aria-labelledby="payments">
        <h2 id="payments">Payments</h2>
        {payments.length === 0 ? <p className="muted">No online payment yet.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Location</th><th className="n">Amount</th><th>Status</th><th>Provider</th><th><span className="sr">Invoice</span></th></tr></thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="nowrap">{formatDate(p.paid_at || p.created_at)}</td>
                    <td>{nameOf(p.business_id)}</td>
                    <td className="n">{formatMoney(p.amount_cents, p.currency)}</td>
                    <td>{p.status}</td>
                    <td>{p.provider}</td>
                    <td>{p.invoice_url && <a href={p.invoice_url} target="_blank" rel="noopener noreferrer">Invoice</a>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {support.length > 0 && (
        <section className="card" aria-labelledby="support">
          <h2 id="support">Support requests</h2>
          {support.map((r) => (
            <div className="review" key={r.id}>
              <strong>{r.topic}</strong> <span className={`badge ${r.status === 'open' ? 'wait' : 'plain'}`}>{r.status.toUpperCase()}</span>
              <div className="muted">{formatDateTime(r.created_at)}</div>
              <div className="quote">{r.message}</div>
            </div>
          ))}
          <a className="btn out small" href="/admin/support">All support requests</a>
        </section>
      )}

      {audit.length > 0 && (
        <section className="card" aria-labelledby="history">
          <h2 id="history">History</h2>
          <div className="table-wrap">
            <table>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id}>
                    <td className="nowrap">{formatDateTime(a.created_at)}</td>
                    <td>{AUDIT[a.action] || a.action}</td>
                    <td className="muted break">{a.action === 'review_url.updated' ? `${a.detail?.from || ''} → ${a.detail?.to || ''}` : a.action === 'pro.manual' ? `${a.detail?.enabled ? 'on' : 'off'}${a.detail?.until ? ` until ${a.detail.until}` : ''}` : ''}</td>
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
