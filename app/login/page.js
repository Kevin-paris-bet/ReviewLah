import { LoginForm } from './form';

export const metadata = { title: 'Log in' };

export default async function Login({ searchParams }) {
  const sp = await searchParams;
  const next = typeof sp.next === 'string' && /^\/(dashboard|admin)[A-Za-z0-9\-_/?=&%.]*$/.test(sp.next) ? sp.next : '';
  return (
    <>
      <div className="top">
        <a className="logo" href="/">ReviewLah<span>.my</span></a>
      </div>
      <div className="wrap narrow">
        <LoginForm next={next} expired={Boolean(sp.error)} />
        <p className="muted" style={{ textAlign: 'center' }}>
          No account yet? Your dashboard is created when you order a plate. <a href="/">Back to the site</a>
        </p>
      </div>
      <footer className="foot"><a href="/privacy">Privacy</a><a href="/terms">Terms</a></footer>
    </>
  );
}
