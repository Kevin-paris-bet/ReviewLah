import { requireAdmin } from '../../lib/admin';
import { NavLinks } from '../ui/client';
import { signOut } from '../dashboard/actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: { default: 'Admin', template: '%s — ReviewLah admin' } };

const ITEMS = [
  { href: '/admin', text: 'Overview', icon: 'home', exact: true },
  { href: '/admin/customers', text: 'Customers', icon: 'user' },
  { href: '/admin/plates', text: 'Plates', icon: 'plate' },
  { href: '/admin/subscriptions', text: 'Plans', icon: 'card' },
  { href: '/admin/support', text: 'Support', icon: 'help' },
  { href: '/admin/system', text: 'System', icon: 'settings', desk: true },
];

export default async function AdminLayout({ children }) {
  const { user } = await requireAdmin();
  return (
    <>
      <header className="top">
        <a className="logo" href="/admin">ReviewLah<span>.my</span><em>admin</em></a>
        <div className="top-right">
          <a className="btn quiet small" href="/dashboard">My dashboard</a>
          <span className="muted top-email">{user.email}</span>
          <form action={signOut}><button className="btn out small" type="submit">Log out</button></form>
        </div>
      </header>
      <div className="shell">
        <NavLinks items={ITEMS} footer={<a href="/admin/system">System and settings</a>} />
        <main className="main" id="main">{children}</main>
      </div>
    </>
  );
}
