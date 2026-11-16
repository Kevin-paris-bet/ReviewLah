import { loadDashboard } from '../../../lib/dashboard';
import { supportEmail, supportWhatsapp } from '../../../lib/env';
import { DASHBOARD_FAQ, SUPPORT_TOPICS } from '../../../lib/faq';
import { Flash } from '../../ui/parts';
import { Submit } from '../../ui/client';
import { Icon } from '../../ui/icons';
import { sendSupportRequest } from '../actions';

export const metadata = { title: 'Help' };

export default async function Help({ searchParams }) {
  const sp = await searchParams;
  const data = await loadDashboard();
  const email = supportEmail();
  const whatsapp = supportWhatsapp();
  const codes = data.plates.map((p) => p.code).join(', ');

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Help</h1>
          <p className="muted">Quick answers first. Still stuck? Write to us at the bottom of this page.</p>
        </div>
      </div>
      <Flash sp={sp} />

      <section className="card" aria-label="Frequent questions">
        {DASHBOARD_FAQ.map(([question, answer]) => (
          <details className="faq" key={question}>
            <summary>{question}</summary>
            <p>{answer}</p>
          </details>
        ))}
      </section>

      <section className="card" aria-labelledby="contact">
        <h2 id="contact">Contact support</h2>
        <p className="muted" style={{ fontSize: 15 }}>
          We reply to <strong>{data.user.email}</strong>, usually within one working day.
          {codes && <> Your plate {data.plates.length > 1 ? 'codes are' : 'code is'} <strong>{codes}</strong>: no need to type {data.plates.length > 1 ? 'them' : 'it'}.</>}
        </p>
        <form action={sendSupportRequest}>
          <div className="field">
            <label htmlFor="topic">Topic</label>
            <select id="topic" name="topic" defaultValue={SUPPORT_TOPICS[0]}>
              {SUPPORT_TOPICS.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="message">Message</label>
            <textarea id="message" name="message" required minLength={5} maxLength={3000} placeholder="Tell us what happens, and on which phone if it is about tapping or scanning." />
          </div>
          <Submit pending="Sending…">Send message</Submit>
        </form>
        {(whatsapp || email) && (
          <>
            <hr className="divider" />
            <p className="muted">Prefer another way?</p>
            <div className="row">
              {whatsapp && (
                <a className="btn out small" href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener noreferrer"><Icon name="whatsapp" /> WhatsApp us</a>
              )}
              {email && <a className="btn out small" href={`mailto:${email}`}><Icon name="mail" /> {email}</a>}
            </div>
          </>
        )}
      </section>
    </>
  );
}
