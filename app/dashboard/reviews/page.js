import { notFound } from 'next/navigation';
import { loadDashboard, pickBusiness } from '../../../lib/dashboard';
import { gbpEnabled, anthropicConfig } from '../../../lib/env';
import { formatDate, timeAgo } from '../../../lib/time';
import { DRAFT_LANGUAGES } from '../../../lib/ai/drafts';
import { Flash, Seg, ProLock, Empty, Stat, Stars, Confirm } from '../../ui/parts';
import { HBars } from '../../ui/charts';
import { Submit, SelectNav } from '../../ui/client';
import { refreshReviews } from '../google/actions';
import { generateDraft, saveDraft, discardDraft, publishReply, deleteReply } from './actions';

export const metadata = { title: 'Reviews' };

const PAGE = 20;
const FILTERS = [['all', 'All'], ['unreplied', 'To reply'], ['replied', 'Replied'], ['low', '1 to 3 stars']];

function ReplyForm({ review, back, ai, editing = false }) {
  const draft = review.draft;
  const initial = editing ? review.reply_comment : draft?.body || '';
  return (
    <>
      <form>
        <input type="hidden" name="review_id" value={review.id} />
        <input type="hidden" name="back" value={back} />
        <input type="hidden" name="language" value={draft?.language || 'en'} />
        <div className="field">
          <label htmlFor={`body-${review.id}`}>
            {editing ? 'Your reply' : draft ? `Draft${draft.source === 'ai' ? ` written by AI in ${DRAFT_LANGUAGES[draft.language]?.name || 'English'}` : ''}: edit it as you like` : 'Your reply'}
          </label>
          <textarea id={`body-${review.id}`} name="body" defaultValue={initial} maxLength={4000} required placeholder="Thank the customer and answer what they wrote." />
          <p className="hint">Nothing is posted until you press “Approve and publish”. The reply is public on Google, under your business name.</p>
        </div>
        <div className="row">
          <Submit formAction={publishReply} pending="Publishing…">{editing ? 'Approve and update on Google' : 'Approve and publish on Google'}</Submit>
          {!editing && <Submit formAction={saveDraft} className="btn out">Save draft</Submit>}
        </div>
      </form>
      {!editing && (
        <div className="row" style={{ marginTop: 10 }}>
          {ai && (
            <form action={generateDraft} className="row">
              <input type="hidden" name="review_id" value={review.id} />
              <input type="hidden" name="back" value={back} />
              <span className="muted">{draft ? 'New AI draft:' : 'AI draft:'}</span>
              {Object.entries(DRAFT_LANGUAGES).map(([code, lang]) => (
                <Submit key={code} name="language" value={code} className="btn out small" pending="Writing…">{lang.label}</Submit>
              ))}
            </form>
          )}
          {draft && (
            <form action={discardDraft}>
              <input type="hidden" name="review_id" value={review.id} />
              <input type="hidden" name="back" value={back} />
              <Submit className="btn quiet small">Discard draft</Submit>
            </form>
          )}
        </div>
      )}
    </>
  );
}

export default async function Reviews({ searchParams }) {
  if (!gbpEnabled()) notFound();
  const sp = await searchParams;
  const data = await loadDashboard();
  if (data.businesses.length === 0) {
    return (
      <>
        <div className="page-head"><h1>Reviews</h1></div>
        <Empty title="No plate is linked to this email yet"><p>Reviews appear once a plate is registered with {data.user.email}.</p></Empty>
      </>
    );
  }
  const b = pickBusiness(data, sp.location, { wantPro: true });
  const filter = FILTERS.some(([key]) => key === sp.filter) ? sp.filter : 'all';
  const offset = Math.max(0, Number(sp.offset) || 0);
  const picker = data.businesses.length > 1 && (
    <SelectNav name="location" label="Location" value={b.id}
      options={data.businesses.map((x) => ({ value: x.id, text: `${x.name}${x.is_pro ? '' : ' (Basic)'}` }))} />
  );
  const head = (
    <div className="page-head">
      <div>
        <h1>Reviews</h1>
        <p className="muted">Google reviews of {b.name}. Reviews are what customers posted on Google; scans are counted separately in Analytics.</p>
      </div>
      <a className="btn out small" href="/dashboard/google">Google connection</a>
    </div>
  );

  if (!b.is_pro) {
    return (
      <>
        {head}
        {picker && <div className="filters">{picker}</div>}
        <ProLock businessId={b.id} title="See new Google reviews and reply faster."
          text="With Pro and your Google Business Profile connected, new reviews appear here, you get an alert by email, and you can prepare replies in English, Bahasa Malaysia or Chinese. You approve every reply before it is published." />
      </>
    );
  }

  const { data: status } = await data.supabase.rpc('google_status');
  const link = (status?.locations || []).find((l) => l.business_id === b.id);
  if (!link) {
    return (
      <>
        {head}
        <Flash sp={sp} />
        {picker && <div className="filters">{picker}</div>}
        <div className="card">
          <h2>Connect Google to see your reviews here</h2>
          <p className="muted" style={{ fontSize: 15 }}>
            Link the Google Business Profile listing of {b.name}. You sign in on Google’s own page; ReviewLah never sees your Google password, and nothing is published without your approval.
          </p>
          <a className="btn" href="/dashboard/google">Set up the Google connection</a>
        </div>
      </>
    );
  }

  const { data: inbox, error } = await data.supabase.rpc('review_inbox', { p_business_id: b.id, p_filter: filter, p_limit: PAGE, p_offset: offset });
  if (error) throw new Error(`review_inbox: ${error.message}`);
  const ai = Boolean(anthropicConfig().apiKey);
  const query = (changes) => {
    const params = new URLSearchParams({ location: b.id, ...(filter !== 'all' ? { filter } : {}), ...(offset ? { offset: String(offset) } : {}) });
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '' || value === 0) params.delete(key);
      else params.set(key, String(value));
    }
    return `/dashboard/reviews?${params.toString()}`;
  };
  const back = query({});
  const counts = { all: inbox.total, unreplied: inbox.unreplied, low: inbox.low, replied: inbox.total - inbox.unreplied };

  return (
    <>
      {head}
      <Flash sp={sp} />

      <div className="filters">
        {picker}
        <form action={refreshReviews}>
          <input type="hidden" name="business_id" value={b.id} />
          <input type="hidden" name="back" value="reviews" />
          <Submit className="btn out small" pending="Updating…">Refresh now</Submit>
        </form>
        <span className="muted">{link.last_synced_at ? `Updated ${timeAgo(link.last_synced_at)}` : 'Import in progress'}</span>
      </div>
      {link.sync_error && <div className="warn">{link.sync_error}</div>}

      <div className="stats three">
        <Stat label="Average rating" value={inbox.average ? Number(inbox.average).toFixed(1) : '–'} sub={`${Number(inbox.total).toLocaleString('en-MY')} imported reviews`} />
        <Stat label="Waiting for a reply" value={Number(inbox.unreplied).toLocaleString('en-MY')} sub={inbox.unreplied > 0 ? 'Replying shows customers you listen' : 'All caught up'} />
        <Stat label="1 to 3 stars" value={Number(inbox.low).toLocaleString('en-MY')} sub="Worth a careful reply" />
      </div>

      {inbox.total > 0 && (
        <section className="card" style={{ marginTop: 16 }} aria-labelledby="ratings">
          <h2 id="ratings">Ratings</h2>
          <HBars caption="Reviews by star rating" highlightTop={false} tableHead={['Rating', 'Reviews']}
            rows={[5, 4, 3, 2, 1].map((s) => ({ key: s, label: `${s} ${s === 1 ? 'star' : 'stars'}`, value: Number(inbox.by_rating?.[s - 1]) || 0 }))} />
        </section>
      )}

      <div className="filters" style={{ marginTop: 16 }}>
        <Seg label="Filter" items={FILTERS.map(([key, name]) => ({ href: query({ filter: key === 'all' ? null : key, offset: null }), text: `${name} (${counts[key]})`, active: key === filter }))} />
      </div>

      <section className="card" aria-label="Reviews">
        {inbox.rows.length === 0 && (
          <p className="muted">
            {inbox.total === 0 ? 'No review imported yet. New reviews appear here a few minutes after they are posted on Google.' : 'No review matches this filter.'}
          </p>
        )}
        {inbox.rows.map((r) => (
          <article className="review" key={r.id} id={`r-${r.id}`}>
            <div className="row spread">
              <div>
                <Stars rating={r.rating} /> <strong>{r.reviewer_name || 'Google user'}</strong>
                <div className="muted">{r.create_time ? formatDate(r.create_time) : ''}{r.update_time && r.create_time && r.update_time.slice(0, 10) !== r.create_time.slice(0, 10) ? `, edited ${formatDate(r.update_time)}` : ''}</div>
              </div>
              {r.reply_comment ? <span className="badge on">REPLIED</span> : r.draft ? <span className="badge wait">DRAFT</span> : <span className="badge plain">NO REPLY YET</span>}
            </div>
            {r.comment ? <div className="quote">{r.comment}</div> : <p className="muted" style={{ marginTop: 8 }}>Rating only, no text.</p>}

            {r.reply_comment ? (
              <>
                <div className="reply">
                  <span className="muted">Your reply{r.reply_update_time ? `, ${formatDate(r.reply_update_time)}` : ''}</span>
                  <div>{r.reply_comment}</div>
                </div>
                <div className="row">
                  <details>
                    <summary className="btn out small" style={{ display: 'inline-flex', listStyle: 'none' }}>Edit reply</summary>
                    <div style={{ marginTop: 10 }}><ReplyForm review={r} back={back} ai={false} editing /></div>
                  </details>
                  <Confirm summary="Delete reply">
                    <p>Removes your reply from Google. The customer’s review stays.</p>
                    <form action={deleteReply}>
                      <input type="hidden" name="review_id" value={r.id} />
                      <input type="hidden" name="back" value={back} />
                      <Submit className="btn danger small" pending="Deleting…">Yes, delete my reply</Submit>
                    </form>
                  </Confirm>
                </div>
              </>
            ) : (
              <ReplyForm review={r} back={back} ai={ai} />
            )}
          </article>
        ))}

        {(offset > 0 || offset + PAGE < inbox.matching) && (
          <div className="row spread" style={{ marginTop: 12 }}>
            <span className="muted">{offset + 1} to {Math.min(offset + PAGE, inbox.matching)} of {inbox.matching}</span>
            <div className="row">
              {offset > 0 && <a className="btn out small" href={query({ offset: Math.max(0, offset - PAGE) })}>Newer</a>}
              {offset + PAGE < inbox.matching && <a className="btn out small" href={query({ offset: offset + PAGE })}>Older</a>}
            </div>
          </div>
        )}
      </section>
      {!ai && <p className="muted">AI drafts are not switched on yet. You can write your replies here and publish them once approved.</p>}
    </>
  );
}
