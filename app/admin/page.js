import { redirect } from 'next/navigation';
import { createClient } from '../../lib/supabase/server';
import { signOut, createPlate, togglePlate, updatePlate } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Admin — ReviewLah.my' };

export default async function Admin({ searchParams }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: isAdmin } = await supabase.rpc('is_admin');
  if (!isAdmin) {
    return (
      <div className="wrap" style={{ maxWidth: 560 }}>
        <div className="card">
          <h1>Admin only</h1>
          <p className="muted">You are logged in as {user.email}, which is not an administrator. See supabase/schema.sql (step 2) to add yourself.</p>
          <a className="btn out small" href="/dashboard">Go to my dashboard</a>
        </div>
      </div>
    );
  }

  const { data: plates } = await supabase.from('plates').select('*').order('created_at', { ascending: false });
  const counts = {};
  for (const p of plates || []) {
    const { count } = await supabase.from('scans').select('*', { count: 'exact', head: true }).eq('plate_id', p.id);
    counts[p.id] = count || 0;
  }

  return (
    <>
      <div className="top">
        <a className="logo" href="/">ReviewLah<span>.my</span> <span style={{ background: 'none', color: '#536780', fontSize: 14 }}>admin</span></a>
        <form action={signOut} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span className="muted">{user.email}</span>
          <button className="btn out small" type="submit">Log out</button>
        </form>
      </div>
      <div className="wrap">
        <h1>Plates</h1>
        {sp.error && <div className="err">{sp.error}</div>}
        {sp.saved && <div className="ok">Saved.</div>}
        {sp.created && (
          <div className="ok">
            Plate created: code <strong>{sp.created}</strong>. Write these two addresses on the plate:
            <br />NFC chip: <code>https://go.reviewlah.my/{sp.created}?nfc</code>
            <br />QR code: <code>https://go.reviewlah.my/{sp.created}?qr</code>
          </div>
        )}

        <div className="card">
          <h2>New plate</h2>
          <form action={createPlate}>
            <div className="grid2">
              <div className="field"><label htmlFor="business_name">Business name</label><input id="business_name" name="business_name" required maxLength={100} /></div>
              <div className="field"><label htmlFor="owner_email">Customer email <span className="muted">(they log in with it)</span></label><input id="owner_email" name="owner_email" type="email" /></div>
            </div>
            <div className="grid2">
              <div className="field"><label htmlFor="destination_url">Google review link</label><input id="destination_url" name="destination_url" type="url" required placeholder="https://g.page/r/…/review" /></div>
              <div className="field"><label htmlFor="plan">Plan</label><select id="plan" name="plan"><option value="basic">Basic</option><option value="pro">Pro</option></select></div>
            </div>
            <button className="btn" type="submit">Create plate</button>
          </form>
        </div>

        <div className="card" style={{ overflowX: 'auto' }}>
          <h2>All plates ({plates?.length || 0})</h2>
          <table>
            <thead><tr><th>Code</th><th>Business</th><th>Customer</th><th>Plan / link</th><th>Scans</th><th></th></tr></thead>
            <tbody>
              {(plates || []).map((p) => (
                <tr key={p.id}>
                  <td><code>{p.code}</code></td>
                  <td>{p.business_name} {!p.active && <span className="badge off">PAUSED</span>}</td>
                  <td>{p.owner_email || '—'}{p.owner_id ? '' : p.owner_email ? ' (not logged in yet)' : ''}</td>
                  <td>
                    <form action={updatePlate} style={{ display: 'grid', gap: 6, minWidth: 260 }}>
                      <input type="hidden" name="id" value={p.id} />
                      <select name="plan" defaultValue={p.plan}><option value="basic">Basic</option><option value="pro">Pro</option></select>
                      <input name="destination_url" type="url" defaultValue={p.destination_url} required />
                      <button className="btn out small" type="submit">Save</button>
                    </form>
                  </td>
                  <td>{counts[p.id]}</td>
                  <td>
                    <form action={togglePlate}>
                      <input type="hidden" name="id" value={p.id} />
                      <input type="hidden" name="active" value={String(p.active)} />
                      <button className="btn out small" type="submit">{p.active ? 'Pause' : 'Activate'}</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
