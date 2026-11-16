import { loadDashboard } from '../../../lib/dashboard';
import { checkoutProvider } from '../../../lib/payments';
import { PRO_FEATURES, PRO_PRICES, YEARLY_SAVING, BASIC_FEATURES, formatMoney } from '../../../lib/plans';
import { formatDate } from '../../../lib/time';
import { supportWhatsapp } from '../../../lib/env';
import { Flash, PlanBadge, Confirm, Empty } from '../../ui/parts';
import { Submit } from '../../ui/client';
import { Icon } from '../../ui/icons';
import { startCheckout, setRenewal } from './actions';

export const metadata = { title: 'Plan and payments' };

const PAYMENT_STATUS = {
  succeeded: ['Paid', 'on'],
  pending: ['Pending', 'wait'],
  failed: ['Failed', 'off'],
  refunded: ['Refunded', 'plain'],
};

function Upgrade({ business, canPay, whatsapp }) {
  if (!canPay) {
    return (
      <div className="note">
        <strong>Online payment opens soon.</strong> Want Pro for {business.name} now? Tell us and we switch it on for you.
        <div className="row" style={{ marginTop: 10 }}>
          <a className="btn small" href="/dashboard/help#contact">Ask for Pro</a>
          {whatsapp && <a className="btn out small" href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener noreferrer"><Icon name="whatsapp" /> WhatsApp us</a>}
        </div>
      </div>
    );
  }
  return (
    <div className="grid2" style={{ marginBottom: 0 }}>
      {['year', 'month'].map((interval) => (
        <form action={startCheckout} className="choice" key={interval}>
          <input type="hidden" name="business_id" value={business.id} />
          <input type="hidden" name="interval" value={interval} />
          <strong>{interval === 'year' ? 'Pro yearly' : 'Pro monthly'}</strong>
          <div className="price">RM{PRO_PRICES[interval].amount} <small>/ {interval}</small></div>
          <p className="muted">
            {interval === 'year' ? `Two months free: you save RM${YEARLY_SAVING} compared with monthly.` : 'Billed every month.'} For this location only.
          </p>
          <Submit className="btn full" pending="Opening secure payment…">{interval === 'year' ? 'Get Pro yearly' : 'Get Pro monthly'}</Submit>
        </form>
      ))}
    </div>
  );
}

function Location({ b, canPay, whatsapp, unpaidInvoice }) {
  const sub = b.subscription;
  const live = sub && ['trialing', 'active', 'past_due'].includes(sub.status) && b.is_pro;
  const manual = live && sub.provider === 'manual';
  const end = sub?.current_period_end ? formatDate(sub.current_period_end) : null;
  const price = sub?.billing_interval ? PRO_PRICES[sub.billing_interval]?.label : null;

  return (
    <section className="card" aria-label={`Plan of ${b.name}`}>
      <div className="card-head">
        <div>
          <h2>{b.name}</h2>
          <PlanBadge pro={b.is_pro} />
        </div>
      </div>

      {!live && (
        <>
          <p>
            <strong>Basic</strong>, included with your plate.
            {sub?.status === 'canceled' && sub.provider !== 'manual' ? ' Pro has ended for this location; your scan history is kept.' : ''}
          </p>
          <Upgrade business={b} canPay={canPay} whatsapp={whatsapp} />
        </>
      )}

      {live && manual && (
        <>
          <p><strong>Pro</strong>, switched on for you by the ReviewLah team{end ? `, until ${end}` : ''}. Nothing is charged.</p>
          {end && canPay && (
            <details>
              <summary className="linkbtn" style={{ listStyle: 'none' }}>Keep Pro after {end}</summary>
              <div style={{ marginTop: 12 }}><Upgrade business={b} canPay={canPay} whatsapp={whatsapp} /></div>
            </details>
          )}
        </>
      )}

      {live && !manual && (
        <>
          {sub.status === 'past_due' && (
            <div className="warn">
              The last payment did not go through. It is retried automatically and Pro stays on in the meantime.
              {unpaidInvoice && <> You can also <a href={unpaidInvoice} target="_blank" rel="noopener noreferrer">pay the invoice now</a>.</>}
            </div>
          )}
          {sub.cancel_at_period_end ? (
            <>
              <p><strong>Pro{end ? ` until ${end}` : ''}.</strong> Renewal is cancelled: nothing more will be charged. After that date this location goes back to Basic, and your plate keeps working.</p>
              <form action={setRenewal}>
                <input type="hidden" name="subscription_id" value={sub.id} />
                <input type="hidden" name="cancel" value="false" />
                <Submit className="btn out small">Keep Pro: turn renewal back on</Submit>
              </form>
            </>
          ) : (
            <>
              <p><strong>Pro{price ? `, ${price}` : ''}.</strong>{end ? ` Renews on ${end}.` : ''}</p>
              <Confirm summary="Cancel renewal">
                <p>
                  Pro stays on{end ? ` until ${end}` : ' until the end of the period you paid for'}, then this location goes back to Basic.
                  Your plate keeps opening your Google review page and your total scan count stays available.
                </p>
                <form action={setRenewal}>
                  <input type="hidden" name="subscription_id" value={sub.id} />
                  <input type="hidden" name="cancel" value="true" />
                  <Submit className="btn danger small" pending="Cancelling…">Yes, cancel renewal</Submit>
                </form>
              </Confirm>
            </>
          )}
        </>
      )}
    </section>
  );
}

export default async function Billing({ searchParams }) {
  const sp = await searchParams;
  const data = await loadDashboard();
  const canPay = Boolean(checkoutProvider());
  const whatsapp = supportWhatsapp();
  const order = (b) => (b.id === sp.location ? 0 : 1);
  const businesses = [...data.businesses].sort((a, b) => order(a) - order(b));
  const hasBasic = businesses.some((b) => !b.is_pro);

  let payments = [];
  if (businesses.length) {
    const result = await data.supabase.from('payments')
      .select('id,business_id,status,amount_cents,currency,description,invoice_url,paid_at,created_at')
      .order('created_at', { ascending: false }).limit(36);
    payments = result.data || [];
  }
  const nameOf = (id) => data.businesses.find((b) => b.id === id)?.name || '';
  const unpaidInvoice = (id) => payments.find((p) => p.business_id === id && (p.status === 'failed' || p.status === 'pending') && p.invoice_url)?.invoice_url || null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Plan and payments</h1>
          <p className="muted">Pro is optional and billed per location. Your plate works the same with or without it.</p>
        </div>
      </div>
      <Flash sp={sp} />

      {businesses.length === 0 && (
        <Empty title="No plate is linked to this email yet"><p>Your plan appears here once a plate is registered with {data.user.email}.</p></Empty>
      )}

      {hasBasic && (
        <section className="card blue" aria-label="What Pro adds">
          <span className="badge">OPTIONAL PRO</span>
          <h2 style={{ marginTop: 10 }}>What Pro adds</h2>
          <div className="grid2" style={{ marginBottom: 0 }}>
            <div>
              <h3>Basic, included with your plate</h3>
              <ul className="checks">{BASIC_FEATURES.map((f) => <li key={f}>{f}</li>)}</ul>
            </div>
            <div>
              <h3>Pro, {PRO_PRICES.month.short} or {PRO_PRICES.year.short} per location</h3>
              <ul className="checks">{PRO_FEATURES.map((f) => <li key={f}>{f}</li>)}</ul>
            </div>
          </div>
          <p className="muted" style={{ margin: 0 }}>
            Pro shows how your plate is used. It does not change how many reviews you get, and it never filters who can leave one.
          </p>
        </section>
      )}

      {businesses.map((b) => <Location key={b.id} b={b} canPay={canPay} whatsapp={whatsapp} unpaidInvoice={unpaidInvoice(b.id)} />)}

      {businesses.length > 0 && (
        <section className="card" aria-labelledby="payments">
          <h2 id="payments">Payments</h2>
          {payments.length === 0 ? (
            <p className="muted">No payment yet. The plate itself is paid once when you order it; payments for Pro appear here.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Date</th><th>Location</th><th>For</th><th className="n">Amount</th><th>Status</th><th aria-label="Invoice" /></tr></thead>
                <tbody>
                  {payments.map((p) => {
                    const [label, cls] = PAYMENT_STATUS[p.status] || [p.status, 'plain'];
                    return (
                      <tr key={p.id}>
                        <td className="nowrap">{formatDate(p.paid_at || p.created_at)}</td>
                        <td>{nameOf(p.business_id)}</td>
                        <td>{p.description || 'ReviewLah Pro'}</td>
                        <td className="n">{formatMoney(p.amount_cents, p.currency)}</td>
                        <td><span className={`badge ${cls}`}>{label.toUpperCase()}</span></td>
                        <td>{p.invoice_url && <a href={p.invoice_url} target="_blank" rel="noopener noreferrer">Invoice</a>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {businesses.length > 0 && (
        <p className="muted">
          If you cancel Pro, your plate and your Basic dashboard keep working. Questions about a payment? <a href="/dashboard/help#contact">Contact us</a>.
        </p>
      )}
    </>
  );
}
