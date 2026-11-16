export const metadata = { title: 'Dashboard update in progress' };

// Shown when the app is ahead of the database (a migration has not been applied yet).
export default function Pending() {
  return (
    <>
      <div className="top"><a className="logo" href="/">ReviewLah<span>.my</span></a></div>
      <div className="wrap narrow">
        <div className="card">
          <h1>We are updating your dashboard.</h1>
          <p className="muted" style={{ fontSize: 15 }}>
            Your plate keeps working as usual: customers still reach your Google review page.
            The dashboard will be back shortly.
          </p>
          <a className="btn" href="/dashboard">Try again</a>
        </div>
      </div>
    </>
  );
}
