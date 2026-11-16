import { notFound } from 'next/navigation';
import { loadDashboard } from '../../../lib/dashboard';
import { gbpEnabled } from '../../../lib/env';
import { adminClient } from '../../../lib/supabase/admin';
import { oauthConfigured } from '../../../lib/google/oauth';
import { listAllLocations } from '../../../lib/google/api';
import { accessTokenFor, loadConnection } from '../../../lib/google/sync';
import { formatDate, timeAgo } from '../../../lib/time';
import { Flash, PlanBadge, Confirm, Empty } from '../../ui/parts';
import { Submit } from '../../ui/client';
import { connectGoogle, linkListing, unlinkListing, refreshReviews, disconnectGoogle } from './actions';

export const metadata = { title: 'Google connection' };

async function availableListings(companyId) {
  const admin = adminClient();
  if (!admin) return { error: true, locations: [] };
  try {
    const connection = await loadConnection(admin, companyId);
    const token = connection && connection.status === 'active' ? await accessTokenFor(admin, connection) : null;
    if (!token) return { error: true, locations: [] };
    return { error: false, locations: (await listAllLocations(token)).locations };
  } catch {
    return { error: true, locations: [] };
  }
}

function Explain() {
  return (
    <>
      <h3>What ReviewLah does with this access</h3>
      <ul className="checks">
        <li>Reads the list of business listings you manage, so you can choose which one belongs to each location.</li>
        <li>Reads the reviews of the listings you link: reviewer name, rating, text, date and your replies.</li>
        <li>Publishes a reply to a review only after you have read it and pressed “Approve and publish”. Nothing is ever posted automatically.</li>
      </ul>
      <p className="muted">
        You sign in on Google’s own page: ReviewLah never sees your Google password. We do not edit your listing, your photos or your business details.
        You can disconnect and delete everything we imported at any time. See our <a href="/privacy">privacy policy</a>.
      </p>
    </>
  );
}

export default async function Google({ searchParams }) {
  if (!gbpEnabled()) notFound();
  const sp = await searchParams;
  const data = await loadDashboard();
  const configured = oauthConfigured() && Boolean(adminClient());
  const { data: status, error } = await data.supabase.rpc('google_status');
  if (error) throw new Error(`google_status: ${error.message}`);
  const linkOf = (businessId) => status.locations.find((l) => l.business_id === businessId) || null;

  return (
    <>
      <p className="muted"><a href="/dashboard/reviews">Reviews</a> / Google connection</p>
      <div className="page-head">
        <div>
          <h1>Google connection</h1>
          <p className="muted">Connect your Google Business Profile to see new reviews here and reply faster. Part of Pro.</p>
        </div>
      </div>
      <Flash sp={sp} />

      {data.companies.length === 0 && (
        <Empty title="No plate is linked to this email yet"><p>The Google connection appears once a plate is registered with {data.user.email}.</p></Empty>
      )}

      {await Promise.all(data.companies.map(async (company) => {
        const connection = status.connections.find((c) => c.company_id === company.id) || null;
        const businesses = data.businesses.filter((b) => b.company_id === company.id);
        const active = connection?.status === 'active';
        const needsChoice = active && businesses.some((b) => b.is_pro && !linkOf(b.id));
        const listings = needsChoice ? await availableListings(company.id) : { error: false, locations: [] };
        const taken = new Set(status.locations.map((l) => `${l.account_name}|${l.location_name}`));

        return (
          <div key={company.id}>
            <section className="card" aria-label={`Google connection of ${company.name}`}>
              {!connection && (
                <>
                  <h2>Connect your Google Business Profile</h2>
                  <Explain />
                  {configured ? (
                    <form action={connectGoogle}>
                      <input type="hidden" name="company_id" value={company.id} />
                      <Submit pending="Opening Google…">Connect Google</Submit>
                    </form>
                  ) : (
                    <div className="note">The Google connection is being set up on our side. It will open here soon.</div>
                  )}
                </>
              )}
              {connection && (
                <>
                  <div className="card-head">
                    <div>
                      <h2>{active ? 'Google is connected' : 'Google needs to be connected again'}</h2>
                      <span className={`badge ${active ? 'on' : 'off'}`}>{active ? 'CONNECTED' : 'ACCESS WITHDRAWN'}</span>
                    </div>
                  </div>
                  <p>
                    Account: <strong>{connection.account_label || 'Google account'}</strong>, connected on {formatDate(connection.connected_at)}.
                  </p>
                  {connection.last_error && <div className="warn">{connection.last_error}</div>}
                  {!active && configured && (
                    <form action={connectGoogle} style={{ marginBottom: 14 }}>
                      <input type="hidden" name="company_id" value={company.id} />
                      <Submit pending="Opening Google…">Connect Google again</Submit>
                    </form>
                  )}
                  <Confirm summary="Disconnect Google and delete data">
                    <p>
                      This withdraws ReviewLah’s access to your Google account and permanently deletes everything we imported:
                      the stored access, the linked listings, every imported review and every reply draft.
                      Your reviews and replies on Google itself are not touched. Your plate and your scan statistics keep working.
                    </p>
                    <form action={disconnectGoogle}>
                      <input type="hidden" name="company_id" value={company.id} />
                      <Submit className="btn danger small" pending="Deleting…">Yes, disconnect and delete</Submit>
                    </form>
                  </Confirm>
                </>
              )}
            </section>

            {connection && businesses.map((b) => {
              const link = linkOf(b.id);
              const choices = listings.locations.filter((l) => !taken.has(`${l.accountName}|${l.locationName}`));
              return (
                <section className="card" key={b.id} aria-label={`Google listing of ${b.name}`}>
                  <div className="card-head">
                    <div><h2>{b.name}</h2><PlanBadge pro={b.is_pro} /></div>
                    {link && b.is_pro && <a className="btn small" href={`/dashboard/reviews?location=${b.id}`}>See reviews</a>}
                  </div>
                  {link ? (
                    <>
                      <p>
                        Linked to <strong>{link.title}</strong>{link.address ? `, ${link.address}` : ''}.
                        {link.total_review_count !== null && <> {Number(link.total_review_count).toLocaleString('en-MY')} reviews on Google{link.average_rating ? `, average ${Number(link.average_rating).toFixed(1)}` : ''}.</>}
                      </p>
                      <p className="muted">{link.last_synced_at ? `Reviews last updated ${timeAgo(link.last_synced_at)}.` : 'Reviews are being imported.'}</p>
                      {link.sync_error && <div className="warn">{link.sync_error}</div>}
                      {!b.is_pro && <div className="note" style={{ marginBottom: 12 }}>Pro is off for this location: reviews are no longer updated. They are deleted 30 days after Pro ends, or right now if you unlink.</div>}
                      <div className="row">
                        {b.is_pro && active && (
                          <form action={refreshReviews}>
                            <input type="hidden" name="business_id" value={b.id} />
                            <Submit className="btn out small" pending="Updating…">Refresh now</Submit>
                          </form>
                        )}
                        <Confirm summary="Unlink this listing">
                          <p>Unlinking deletes the reviews and drafts imported for {b.name}. Nothing changes on Google.</p>
                          <form action={unlinkListing}>
                            <input type="hidden" name="business_id" value={b.id} />
                            <Submit className="btn danger small">Yes, unlink</Submit>
                          </form>
                        </Confirm>
                      </div>
                    </>
                  ) : !b.is_pro ? (
                    <p className="muted">Reviews and reply drafts are part of Pro. <a href={`/dashboard/billing?location=${b.id}`}>See Pro</a>.</p>
                  ) : !active ? (
                    <p className="muted">Connect Google again to choose a listing.</p>
                  ) : listings.error ? (
                    <div className="warn">Google did not answer. Reload this page in a moment.</div>
                  ) : choices.length === 0 ? (
                    <p className="muted">
                      No available listing found in this Google account. Check that you connected the Google account that manages {b.name} on Google Business Profile.
                    </p>
                  ) : (
                    <form action={linkListing} className="inline-form">
                      <input type="hidden" name="business_id" value={b.id} />
                      <div className="field">
                        <label htmlFor={`listing-${b.id}`}>Which Google listing is {b.name}?</label>
                        <select id={`listing-${b.id}`} name="listing" required defaultValue="">
                          <option value="" disabled>Choose a listing</option>
                          {choices.map((l) => (
                            <option key={`${l.accountName}|${l.locationName}`} value={`${l.accountName}|${l.locationName}`}>
                              {l.title}{l.address ? ` — ${l.address}` : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                      <Submit pending="Importing reviews…">Link and import reviews</Submit>
                    </form>
                  )}
                </section>
              );
            })}
          </div>
        );
      }))}
    </>
  );
}
