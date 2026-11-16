import { loadDashboard } from '../../lib/dashboard';
import { gbpEnabled } from '../../lib/env';
import { NavLinks } from '../ui/client';
import { signOut } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: { default: 'Dashboard', template: '%s — ReviewLah.my' } };

export default async function DashboardLayout({ children }) {
  const data = await loadDashboard();
  const google = gbpEnabled();
  const items = [
    { href: '/dashboard', text: 'Overview', icon: 'home', exact: true, also: ['/dashboard/locations'] },
    { href: '/dashboard/analytics', text: 'Analytics', icon: 'chart', also: ['/dashboard/compare'] },
    ...(google ? [{ href: '/dashboard/reviews', text: 'Reviews', icon: 'star', also: ['/dashboard/google'] }] : []),
    { href: '/dashboard/links', text: 'Links', icon: 'link', desk: google },
    { href: '/dashboard/billing', text: 'Plan', icon: 'card' },
    { href: '/dashboard/account', text: 'Account', icon: 'user' },
    { href: '/dashboard/help', text: 'Help', icon: 'help', desk: true },
  ];
  return (
    <>
      <header className="top">
        <a className="logo" href="/dashboard">ReviewLah<span>.my</span></a>
        <div className="top-right">
          {data.isAdmin && <a className="btn quiet small" href="/admin">Admin</a>}
          <span className="muted top-email">{data.user.email}</span>
          <form action={signOut}><button className="btn out small" type="submit">Log out</button></form>
        </div>
      </header>
      <div className="shell">
        <NavLinks items={items} footer={<>Need a hand? <a href="/dashboard/help">Help and contact</a></>} />
        <main className="main" id="main">{children}</main>
      </div>
    </>
  );
}
