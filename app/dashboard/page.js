import { redirect } from 'next/navigation';
import { createClient } from '../../lib/supabase/server';
import { signOut } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dashboard — ReviewLah.my' };

const DAYS = 30;

function Header({ email }) {
  return (
    <div className="top">
      <a className="logo" href="/">ReviewLah<span>.my</span></a>
      <form action={signOut} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <span className="muted">{email}</span>
        <button className="btn out small" type="submit">Log out</button>
      </form>
    </div>
  );
}

export default async function Dashboard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  await supabase.rpc('claim_plates');
  const { data: plates } = await supabase.from('plates').select('*').eq('owner_id', user.id).order('created_at');

  const since = new Date(Date.now() - DAYS * 86400000).toISOString();
  const items = [];
  for (const plate of plates || []) {
    const { count } = await supabase.from('scans').select('*', { count: 'exact', head: true }).eq('plate_id', plate.id);
    let days = null;
    let nfc = 0;
    let qr = 0;
    if (plate.plan === 'pro') {
      const { data: scans } = await supabase.from('scans').select('created_at, source').eq('plate_id', plate.id).gte('created_at', since).order('created_at').limit(20000);
      const perDay = new Array(DAYS).fill(0);
      for (const s of scans || []) {
        const idx = DAYS - 1 - Math.floor((Date.now() - new Date(s.created_at).getTime()) / 86400000);
        if (idx >= 0 && idx < DAYS) perDay[idx] += 1;
        if (s.source === 'nfc') nfc += 1;
        else if (s.source === 'qr') qr += 1;
      }
      days = perDay;
    }
    items.push({ plate, total: count || 0, days, nfc, qr });
  }

  return (
    <>
      <Header email={user.email} />
      <div className="wrap">
        <h1>Your business, at a glance.</h1>
        <p className="muted">A scan means someone tapped or scanned your plate. It does not prove a review was posted.</p>

        {items.length === 0 && (
          <div className="card">
            <h2>No plate linked to this email yet</h2>
            <p className="muted">Use the same email address you gave us when you ordered. If you think this is a mistake, contact us.</p>
          </div>
        )}

        {items.map(({ plate, total, days, nfc, qr }) => {
          const max = days ? Math.max(1, ...days) : 1;
          const channels = nfc + qr || 1;
          return (
            <div className="card" key={plate.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <h2 style={{ marginBottom: 4 }}>{plate.business_name}</h2>
                  <span className={`badge ${plate.plan === 'pro' ? 'pro' : ''}`}>{plate.plan === 'pro' ? 'PRO' : 'BASIC'}</span>{' '}
                  {!plate.active && <span className="badge off">PAUSED</span>}
                </div>
                <div className="muted">Plate code <code>{plate.code}</code></div>
              </div>

              <div className="stats" style={{ marginTop: 18 }}>
                <div className="stat"><strong>{total}</strong><span className="muted">Total scans · all time</span></div>
                {days && <div className="stat"><strong>{nfc}</strong><span className="muted">NFC taps · last {DAYS} days</span></div>}
                {days && <div className="stat"><strong>{qr}</strong><span className="muted">QR scans · last {DAYS} days</span></div>}
              </div>

              {days ? (
                <>
                  <h2 style={{ marginTop: 24 }}>Scans per day · last {DAYS} days</h2>
                  <div className="chart" role="img" aria-label={`Scans per day over the last ${DAYS} days`}>
                    {days.map((n, i) => <i key={i} title={`${n}`} style={{ height: `${(n / max) * 100}%` }} />)}
                  </div>
                  <div style={{ marginTop: 18 }}>
                    <div className="muted">NFC {Math.round((nfc / channels) * 100)}%</div>
                    <div className="bar"><span style={{ width: `${(nfc / channels) * 100}%` }} /></div>
                    <div className="muted">QR {Math.round((qr / channels) * 100)}%</div>
                    <div className="bar"><span style={{ width: `${(qr / channels) * 100}%` }} /></div>
                  </div>
                </>
              ) : (
                <div className="note" style={{ marginTop: 18 }}>
                  Want to see scans by day and NFC versus QR? That is ReviewLah Pro. Your plate keeps working with or without it.
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
