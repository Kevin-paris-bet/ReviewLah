'use client';
import { useState } from 'react';
import { createClient } from '../../lib/supabase/client';

export default function Login() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState('idle'); // idle | sending | sent | error
  const [message, setMessage] = useState('');

  async function submit(e) {
    e.preventDefault();
    setState('sending');
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setState('error');
      setMessage(error.message);
    } else {
      setState('sent');
    }
  }

  return (
    <>
      <div className="top">
        <a className="logo" href="/">ReviewLah<span>.my</span></a>
      </div>
      <div className="wrap" style={{ maxWidth: 480 }}>
        <div className="card">
          <h1>Log in</h1>
          <p className="muted">Enter your email. We send you a one-click login link. No password needed.</p>
          {state === 'sent' ? (
            <div className="ok">Check your inbox: we sent a login link to {email}. You can close this tab.</div>
          ) : (
            <form onSubmit={submit}>
              {state === 'error' && <div className="err">{message}</div>}
              <div className="field">
                <label htmlFor="email">Email</label>
                <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@yourbusiness.com" />
              </div>
              <button className="btn" type="submit" disabled={state === 'sending'}>
                {state === 'sending' ? 'Sending…' : 'Send me a login link'}
              </button>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
