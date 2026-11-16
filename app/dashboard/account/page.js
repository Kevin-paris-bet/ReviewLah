import { loadDashboard } from '../../../lib/dashboard';
import { gbpEnabled } from '../../../lib/env';
import { Flash, Empty } from '../../ui/parts';
import { Submit } from '../../ui/client';
import { updateAccount, changeLoginEmail, signOut } from '../actions';

export const metadata = { title: 'Account' };

export default async function Account({ searchParams }) {
  const sp = await searchParams;
  const data = await loadDashboard();
  const google = gbpEnabled();

  return (
    <>
      <div className="page-head"><h1>Account</h1></div>
      <Flash sp={sp} />

      {data.companies.length === 0 && (
        <Empty title="No business linked to this login yet">
          <p>Your contact details appear here once a plate is registered with <strong>{data.user.email}</strong>.</p>
        </Empty>
      )}

      {data.companies.map((c) => (
        <section className="card" key={c.id} aria-label={`Details of ${c.name}`}>
          <h2>Your details</h2>
          <form action={updateAccount}>
            <input type="hidden" name="company_id" value={c.id} />
            <div className="grid2">
              <div className="field">
                <label htmlFor={`name-${c.id}`}>Business or company name</label>
                <input id={`name-${c.id}`} name="name" defaultValue={c.name} required maxLength={100} autoComplete="organization" />
              </div>
              <div className="field">
                <label htmlFor={`contact-${c.id}`}>Your name</label>
                <input id={`contact-${c.id}`} name="contact_name" defaultValue={c.contact_name || ''} maxLength={100} autoComplete="name" />
              </div>
              <div className="field">
                <label htmlFor={`phone-${c.id}`}>Phone</label>
                <input id={`phone-${c.id}`} name="phone" type="tel" inputMode="tel" defaultValue={c.phone || ''} maxLength={30} placeholder="+60 12-345 6789" autoComplete="tel" />
              </div>
              <div className="field">
                <label htmlFor={`wa-${c.id}`}>WhatsApp <span className="muted">(if different)</span></label>
                <input id={`wa-${c.id}`} name="whatsapp" type="tel" inputMode="tel" defaultValue={c.whatsapp || ''} maxLength={30} placeholder="+60 12-345 6789" />
              </div>
            </div>
            <h3 style={{ marginTop: 6 }}>Emails we send you</h3>
            <label className="check">
              <input type="checkbox" name="email_monthly_summary" defaultChecked={c.email_monthly_summary} />
              <span>Monthly summary of scans and trends <span className="muted">(Pro locations)</span></span>
            </label>
            {google ? (
              <label className="check">
                <input type="checkbox" name="email_review_alerts" defaultChecked={c.email_review_alerts} />
                <span>Alert when a new Google review arrives <span className="muted">(Pro, Google connected)</span></span>
              </label>
            ) : (
              <input type="hidden" name="email_review_alerts" value={c.email_review_alerts ? 'on' : ''} />
            )}
            <Submit>Save details</Submit>
          </form>
        </section>
      ))}

      <section className="card" aria-labelledby="login-email">
        <h2 id="login-email">Login email</h2>
        <p>You log in with <strong className="break">{data.user.email}</strong>. There is no password: we email you a link each time.</p>
        <form action={changeLoginEmail} className="inline-form">
          <div className="field">
            <label htmlFor="email">New login email</label>
            <input id="email" name="email" type="email" inputMode="email" required maxLength={254} autoComplete="email" placeholder="new@yourbusiness.com" />
          </div>
          <Submit className="btn out" pending="Sending…">Change email</Submit>
        </form>
        <p className="hint">We send a confirmation link to the new address. Nothing changes until you click it.</p>
      </section>

      <section className="card">
        <h2>More</h2>
        <div className="row">
          <a className="btn out small" href="/dashboard/help">Help and contact</a>
          <a className="btn out small" href="/dashboard/billing">Plan and payments</a>
          <a className="btn out small" href="/privacy">Privacy</a>
          <a className="btn out small" href="/terms">Terms</a>
          <form action={signOut}><button className="btn danger small" type="submit">Log out</button></form>
        </div>
      </section>
    </>
  );
}
