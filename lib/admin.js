// Access check shared by every admin page: one cached call per request.
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { getSession, isMissingFunction } from './dashboard';

export const requireAdmin = cache(async () => {
  const { supabase, user } = await getSession();
  if (!user) redirect('/login?next=/admin');
  const { data, error } = await supabase.rpc('is_admin');
  if (error || data !== true) redirect('/dashboard?error=not_allowed');
  return { supabase, user };
});

/** Runs an admin database function; an app ahead of the database is sent to the waiting page. */
export async function adminRpc(supabase, name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    if (isMissingFunction(error)) redirect('/pending');
    throw new Error(`${name}: ${error.message}`);
  }
  return data;
}
