'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '../lib/supabase/server';

const GOOGLE_HOSTS = ['g.page', 'maps.app.goo.gl', 'search.google.com', 'google.com', 'www.google.com', 'maps.google.com', 'google.com.my', 'www.google.com.my', 'goo.gl'];
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid reading mistakes

function validGoogleLink(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && GOOGLE_HOSTS.includes(u.hostname);
  } catch {
    return false;
  }
}

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}

export async function createPlate(formData) {
  const supabase = await createClient();
  const business = String(formData.get('business_name') || '').trim();
  const email = String(formData.get('owner_email') || '').trim().toLowerCase();
  const link = String(formData.get('destination_url') || '').trim();
  const plan = formData.get('plan') === 'pro' ? 'pro' : 'basic';

  if (!business) redirect('/admin?error=' + encodeURIComponent('Business name is required.'));
  if (!validGoogleLink(link)) redirect('/admin?error=' + encodeURIComponent('Use an https Google Maps or review link (g.page, maps.app.goo.gl, google.com…).'));

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode();
    const { error } = await supabase.from('plates').insert({
      code,
      business_name: business,
      owner_email: email || null,
      destination_url: link,
      plan,
    });
    if (!error) {
      revalidatePath('/admin');
      redirect('/admin?created=' + code);
    }
    if (error.code !== '23505') redirect('/admin?error=' + encodeURIComponent(error.message));
  }
  redirect('/admin?error=' + encodeURIComponent('Could not generate a free code, try again.'));
}

export async function togglePlate(formData) {
  const supabase = await createClient();
  const id = String(formData.get('id'));
  const active = formData.get('active') === 'true';
  await supabase.from('plates').update({ active: !active }).eq('id', id);
  revalidatePath('/admin');
}

export async function updatePlate(formData) {
  const supabase = await createClient();
  const id = String(formData.get('id'));
  const link = String(formData.get('destination_url') || '').trim();
  const plan = formData.get('plan') === 'pro' ? 'pro' : 'basic';
  if (!validGoogleLink(link)) redirect('/admin?error=' + encodeURIComponent('Invalid Google link.'));
  await supabase.from('plates').update({ destination_url: link, plan }).eq('id', id);
  revalidatePath('/admin');
  redirect('/admin?saved=1');
}
