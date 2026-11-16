// Server-only client with the secret (service role) key. Used by webhooks, cron jobs and the
// Google integration — never by pages rendered for a visitor, and never sent to the browser.
// The key comes from the SUPABASE_SECRET_KEY environment variable (Vercel), never from the repository.
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL } from './config';
import { serviceKey } from '../env';

let client = null;
let clientKey = '';

/** Returns the service client, or null when SUPABASE_SECRET_KEY is not configured. */
export function adminClient() {
  const key = serviceKey();
  if (!key) return null;
  if (!client || clientKey !== key) {
    client = createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
    clientKey = key;
  }
  return client;
}
