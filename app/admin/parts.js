// Building blocks of the admin pages (server-rendered).
import { goUrl } from '../../lib/env';
import { Submit, CopyButton } from '../ui/client';
import { createBundle } from './actions';

/** New customer + location + plates in one form. With `company`, only the location part is shown. */
export function BundleForm({ company = null }) {
  return (
    <form action={createBundle}>
      {company ? (
        <input type="hidden" name="company_id" value={company.id} />
      ) : (
        <>
          <h3>Customer</h3>
          <div className="grid2">
            <div className="field">
              <label htmlFor="owner_email">Customer email <span className="muted">(their login)</span></label>
              <input id="owner_email" name="owner_email" type="email" inputMode="email" maxLength={254} placeholder="owner@business.com" autoComplete="off" />
              <p className="hint">An existing customer with this email gets the new location added to their account.</p>
            </div>
            <div className="field">
              <label htmlFor="company_name">Company name <span className="muted">(optional)</span></label>
              <input id="company_name" name="company_name" maxLength={100} placeholder="Same as the location if empty" />
            </div>
            <div className="field">
              <label htmlFor="contact_name">Contact name <span className="muted">(optional)</span></label>
              <input id="contact_name" name="contact_name" maxLength={100} />
            </div>
            <div className="field">
              <label htmlFor="phone">Phone / WhatsApp <span className="muted">(optional)</span></label>
              <input id="phone" name="phone" type="tel" inputMode="tel" maxLength={30} placeholder="+60 12-345 6789" />
            </div>
          </div>
          <h3>Location</h3>
        </>
      )}
      <div className="grid2">
        <div className="field">
          <label htmlFor="business_name">Location name</label>
          <input id="business_name" name="business_name" required maxLength={100} placeholder="Kopi Corner Bangsar" />
        </div>
        <div className="field">
          <label htmlFor="address">Address or area <span className="muted">(optional)</span></label>
          <input id="address" name="address" maxLength={200} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="review_url">Google review link</label>
        <input id="review_url" name="review_url" type="url" inputMode="url" required maxLength={600} placeholder="https://g.page/r/…/review" autoComplete="off" />
        <p className="hint">Google review or Google Maps links only. Every customer of the business lands on this same page.</p>
      </div>
      <h3>Plates</h3>
      <div className="grid2">
        <div className="field">
          <label htmlFor="plate_count">Number of plates</label>
          <input id="plate_count" name="plate_count" type="number" inputMode="numeric" min={0} max={50} defaultValue={1} required />
        </div>
        <div className="field">
          <label htmlFor="plate_label">Plate name <span className="muted">(optional)</span></label>
          <input id="plate_label" name="plate_label" maxLength={40} placeholder="Counter" />
        </div>
      </div>
      <h3>Plan</h3>
      <label className="check">
        <input type="checkbox" name="pro" />
        <span>Switch Pro on for this location now <span className="muted">(manual, nothing is charged)</span></span>
      </label>
      <div className="field" style={{ maxWidth: 260 }}>
        <label htmlFor="pro_until">Pro until <span className="muted">(optional)</span></label>
        <input id="pro_until" name="pro_until" type="date" />
      </div>
      <Submit pending="Creating…">{company ? 'Add location and plates' : 'Create customer, location and plates'}</Submit>
    </form>
  );
}

/** The two addresses to program in a plate, with copy buttons. */
export function PlateAddresses({ code }) {
  return (
    <dl className="kv" style={{ marginTop: 8 }}>
      <dt>NFC chip</dt>
      <dd><code>{goUrl(code, 'nfc')}</code> <CopyButton value={goUrl(code, 'nfc')} /></dd>
      <dt>QR code</dt>
      <dd><code>{goUrl(code, 'qr')}</code> <CopyButton value={goUrl(code, 'qr')} /></dd>
    </dl>
  );
}

/** Search box that reloads the page with ?q=… */
export function SearchForm({ action, q, placeholder }) {
  return (
    <form action={action} method="get" className="inline-form" style={{ marginBottom: 16 }} role="search">
      <div className="field">
        <label htmlFor="q" className="sr">Search</label>
        <input id="q" name="q" type="search" defaultValue={q || ''} placeholder={placeholder} maxLength={100} />
      </div>
      <button className="btn out" type="submit">Search</button>
    </form>
  );
}

export function Pager({ base, q, offset, limit, total }) {
  if (total <= limit) return null;
  const link = (o) => `${base}?${new URLSearchParams({ ...(q ? { q } : {}), offset: String(o) }).toString()}`;
  return (
    <div className="row spread" style={{ marginTop: 12 }}>
      <span className="muted">{offset + 1} to {Math.min(offset + limit, total)} of {total}</span>
      <div className="row">
        {offset > 0 && <a className="btn out small" href={link(Math.max(0, offset - limit))}>Previous</a>}
        {offset + limit < total && <a className="btn out small" href={link(offset + limit)}>Next</a>}
      </div>
    </div>
  );
}
