import { notFound } from 'next/navigation';
import { SUPABASE_URL, SUPABASE_KEY } from '../../../lib/supabase/config';
import { Icon, linkIcon } from '../../ui/icons';

// Public links page of one location: reviewlah.my/l/<slug>
// The Google review button is always first and is the same for every visitor (no rating filter).
// Extra links are a Pro feature; without Pro the page still opens and still offers the review button.

async function loadPage(slug) {
  if (!/^[a-z0-9-]{3,60}$/.test(slug)) return null;
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_link_page`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_slug: slug }),
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const page = await loadPage(String(slug).toLowerCase());
  return { title: page?.name || 'ReviewLah.my', robots: { index: false } };
}

function safeHref(url) {
  return /^(https:\/\/|tel:\+?[0-9]|mailto:)/.test(String(url || '')) ? url : null;
}

export default async function LinkPage({ params }) {
  const { slug } = await params;
  const page = await loadPage(String(slug).toLowerCase());
  if (!page) notFound();
  const review = safeHref(page.review_url);
  const links = (Array.isArray(page.links) ? page.links : []).filter((l) => safeHref(l.url));

  return (
    <main className="lp">
      <div className="lp-box">
        <h1>{page.name}</h1>
        {page.headline && <p className="muted" style={{ fontSize: 16 }}>{page.headline}</p>}
        {review && (
          <a className="lp-btn primary" href={review} target="_blank" rel="noopener noreferrer">
            <Icon name="star" /> Review us on Google
          </a>
        )}
        {links.map((link, i) => (
          <a className="lp-btn" key={i} href={link.url} target={link.url.startsWith('https://') ? '_blank' : undefined} rel="noopener noreferrer">
            <Icon name={linkIcon(link.kind)} /> {link.label}
          </a>
        ))}
      </div>
      <p className="lp-foot">Page by <a href="/">ReviewLah.my</a></p>
    </main>
  );
}
