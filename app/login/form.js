'use client';
import { useState } from 'react';
import { createClient } from '../../lib/supabase/client';

export function LoginForm({ next, expired }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [state, setState] = useState('idle'); // idle | sending | sent
  const [message, setMessage] = useState(expired ? 'This login link has expired or was already used. Ask for a new one.' : '');
  const [verifying, setVerifying] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setState('sending');
    setMessage('');
    const supabase = createClient();
    const callback = `${window.location.origin}/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ''}`;
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: callback } });
    if (error) {
      setState('idle');
      setMessage(/rate|limit|seconds/i.test(error.message) ? 'Too many attempts. Wait a minute, then try again.' : error.message);
    } else {
      setState('sent');
    }
  }

  async function verify(e) {
    e.preventDefault();
    setVerifying(true);
    setMessage('');
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
    if (error) {
      setVerifying(false);
      setMessage('This code is not valid or has expired. Check the latest email, or ask for a new link.');
    } else {
      window.location.assign(next || '/dashboard');
    }
  }

  return (
    <div className="card">
      <h1>Log in</h1>
      <p className="muted" style={{ fontSize: 15 }}>
        Enter the email you gave us when you ordered. We send you a login link. No password needed.
      </p>
      {message && <div className="err" role="alert">{message}</div>}
      {state === 'sent' ? (
        <>
          <div className="ok" role="status">Check your inbox: we sent a login link to {email}.</div>
          <details>
            <summary className="linkbtn" style={{ listStyle: 'none' }}>The email shows a 6-digit code? Enter it here</summary>
            <form onSubmit={verify} style={{ marginTop: 12 }}>
              <div className="field">
                <label htmlFor="code">Code from the email</label>
                <input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,8}" required value={code} onChange={(e) => setCode(e.target.value)} />
              </div>
              <button className="btn" type="submit" disabled={verifying}>{verifying ? 'Checking…' : 'Log in with this code'}</button>
            </form>
          </details>
          <p className="muted" style={{ marginTop: 14 }}>
            Nothing received after two minutes? Check your spam folder, or{' '}
            <button type="button" className="linkbtn" onClick={() => setState('idle')}>send it again</button>.
          </p>
        </>
      ) : (
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" required autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@yourbusiness.com" />
          </div>
          <button className="btn full" type="submit" disabled={state === 'sending'}>
            {state === 'sending' ? 'Sending…' : 'Send me a login link'}
          </button>
        </form>
      )}
    </div>
  );
}
