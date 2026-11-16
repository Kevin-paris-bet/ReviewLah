import { loadDashboard, pickBusiness } from '../../../lib/dashboard';
import { siteUrl } from '../../../lib/env';
import { Flash, ProLock, Empty } from '../../ui/parts';
import { Submit, CopyButton, SelectNav, LinksEditor } from '../../ui/client';
import { Icon } from '../../ui/icons';
import { saveLinkPage } from '../actions';

export const metadata = { title: 'Links page' };

export default async function Links({ searchParams }) {
  const sp = await searchParams;
  const data = await loadDashboard();
  if (data.businesses.length === 0) {
    return (
      <>
        <div className="page-head"><h1>Links page</h1></div>
        <Empty title="No plate is linked to this email yet"><p>Your links page appears once a plate is registered with {data.user.email}.</p></Empty>
      </>
    );
  }
  const b = pickBusiness(data, sp.location, { wantPro: true });
  const address = `${siteUrl()}/l/${b.slug}`;
  const picker = data.businesses.length > 1 && (
    <div className="filters">
      <SelectNav
        name="location"
        label="Location"
        value={b.id}
        options={data.businesses.map((x) => ({ value: x.id, text: `${x.name}${x.is_pro ? '' : ' (Basic)'}` }))}
      />
    </div>
  );

  if (!b.is_pro) {
    return (
      <>
        <div className="page-head"><h1>Links page</h1></div>
        {picker}
        <ProLock
          businessId={b.id}
          title="One page for your menu, WhatsApp, booking and socials."
          text="With Pro, each location gets a small page of useful links to share in your Instagram bio, on receipts or by message. The Google review button always comes first."
        />
      </>
    );
  }

  const { data: saved } = await data.supabase.from('link_pages').select('headline,links,published').eq('business_id', b.id).maybeSingle();
  const links = Array.isArray(saved?.links) ? saved.links : [];
  const published = saved ? saved.published : true;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Links page</h1>
          <p className="muted">A small page for {b.name}: your Google review button first, then the links you choose.</p>
        </div>
      </div>
      <Flash sp={sp} />
      {sp.detail && sp.error && <div className="err" role="alert">{String(sp.detail).slice(0, 200)}</div>}
      {picker}

      <section className="card" aria-labelledby="address">
        <h2 id="address">Your page address</h2>
        <p className="break"><a href={address} target="_blank" rel="noopener noreferrer">{address}</a></p>
        <div className="row">
          <a className="btn out small" href={address} target="_blank" rel="noopener noreferrer"><Icon name="external" /> Open page</a>
          <CopyButton value={address} label="Copy address" />
        </div>
        <p className="hint">Share it in your Instagram bio, on WhatsApp or on printed material. Your plate itself keeps opening the Google review page directly.</p>
      </section>

      <section className="card" aria-labelledby="edit">
        <h2 id="edit">Links</h2>
        <p className="muted" style={{ fontSize: 15 }}>
          The first button is always “Review us on Google” and opens the same page for every visitor. Add up to 8 more below.
          For WhatsApp and phone, type the number. For Instagram and TikTok, the account name is enough.
        </p>
        <form action={saveLinkPage}>
          <input type="hidden" name="business_id" value={b.id} />
          <div className="field">
            <label htmlFor="headline">Short welcome line <span className="muted">(optional)</span></label>
            <input id="headline" name="headline" defaultValue={saved?.headline || ''} maxLength={120} placeholder="Thanks for visiting us" />
          </div>
          <LinksEditor initial={links} />
          <label className="check" style={{ marginTop: 16 }}>
            <input type="checkbox" name="published" defaultChecked={published} />
            <span>Show these links on the page <span className="muted">(untick to show only the Google review button)</span></span>
          </label>
          <Submit>Save links page</Submit>
        </form>
      </section>
    </>
  );
}
