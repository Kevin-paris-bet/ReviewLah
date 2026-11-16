// Shared by the server actions of the dashboard and the admin.
import { redirect } from 'next/navigation';
import { createClient } from './supabase/server';

/** The signed-in user and their database client, or a redirect to the login page. */
export async function session() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data?.user) redirect('/login');
  return { supabase, user: data.user };
}

/** Redirects back to a page with ?ok=<code> or ?error=<code> (see lib/messages.js). */
export function go(path, kind, code) {
  redirect(`${path}${path.includes('?') ? '&' : '?'}${kind}=${encodeURIComponent(code)}`);
}

export const text = (formData, name, max = 500) => String(formData.get(name) ?? '').trim().slice(0, max);
