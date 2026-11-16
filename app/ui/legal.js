// Shell shared by the public legal pages (/privacy and /terms).
export const LEGAL_UPDATED = '17 November 2026';

export function LegalPage({ title, intro, children }) {
  return (
    <>
      <header className="top">
        <a className="logo" href="/">ReviewLah<span>.my</span></a>
        <div className="top-right"><a className="btn out small" href="/login">Log in</a></div>
      </header>
      <main className="legal" id="main">
        <h1>{title}</h1>
        <p className="muted">Last updated: {LEGAL_UPDATED}</p>
        {intro}
        {children}
      </main>
      <footer className="foot">
        <a href="/">ReviewLah.my</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a>
        <div style={{ marginTop: 6 }}>ReviewLah is independent of Google. Google and Google Business Profile are trademarks of Google LLC.</div>
      </footer>
    </>
  );
}
