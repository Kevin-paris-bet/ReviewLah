'use server';
// Everything a business owner can change. Each action validates its input, then calls a database
// function that checks ownership again: nothing here trusts an id sent by the browser.
import { redirect } from 'next/navigation';
import { revalidatePath, revalidateTag } from 'next/cache';
import { createClient } from '../../lib/supabase/server';
import { errorCode } from '../../lib/dashboard';
import { validateReviewUrl, isValidPhone, isValidEmail, isUuid, normalizeLinks } from '../../lib/validation';
import { siteUrl } from '../../lib/env';
import { notifySupport } from '../../lib/email/send';

async function session() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data?.user) redirect('/login');
  return { supabase, user: data.user };
}

function go(path, kind, code) {
  redirect(`${path}${path.includes('?') ? '&' : '?'}${kind}=${encodeURIComponent(code)}`);
}

const text = (formData, name, max = 500) => String(formData.get(name) ?? '').trim().slice(0, max);

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}

export async function updateReviewUrl(formData) {
  const { supabase } = await session();
  const id = text(formData, 'business_id', 40);
  const back = `/dashboard/locations/${id}`;
  if (!isUuid(id)) redirect('/dashboard');
  const check = validateReviewUrl(formData.get('review_url'));
  if (!check.ok) go(back, 'error', 'invalid_review_url');
  const { data: plates } = await supabase.from('plates').select('code').eq('business_id', id);
  const { error } = await supabase.rpc('update_business_review_url', { p_business_id: id, p_url: check.url });
  if (error) go(back, 'error', errorCode(error));
  // The plate redirect keeps a short-lived fallback copy of each destination: refresh it.
  for (const plate of plates || []) revalidateTag(`plate:${plate.code}`, 'max');
  revalidatePath('/dashboard', 'layout');
  go(back, 'ok', 'link');
}

export async function updateBusinessDetails(formData) {
  const { supabase } = await session();
  const id = text(formData, 'business_id', 40);
  const back = `/dashboard/locations/${id}`;
  if (!isUuid(id)) redirect('/dashboard');
  const name = text(formData, 'name', 100);
  if (!name) go(back, 'error', 'invalid_name');
  const { error } = await supabase.rpc('update_business_details', { p_business_id: id, p_name: name, p_address: text(formData, 'address', 200) });
  if (error) go(back, 'error', errorCode(error));
  revalidatePath('/dashboard', 'layout');
  go(back, 'ok', 'details');
}

export async function updatePlateLabel(formData) {
  const { supabase } = await session();
  const plateId = text(formData, 'plate_id', 40);
  const businessId = text(formData, 'business_id', 40);
  const back = isUuid(businessId) ? `/dashboard/locations/${businessId}` : '/dashboard';
  if (!isUuid(plateId)) redirect(back);
  const { error } = await supabase.rpc('update_plate_label', { p_plate_id: plateId, p_label: text(formData, 'label', 40) });
  if (error) go(back, 'error', errorCode(error));
  revalidatePath('/dashboard', 'layout');
  go(back, 'ok', 'label');
}

export async function updateAccount(formData) {
  const { supabase } = await session();
  const back = '/dashboard/account';
  const id = text(formData, 'company_id', 40);
  if (!isUuid(id)) redirect(back);
  const name = text(formData, 'name', 100);
  const phone = text(formData, 'phone', 30);
  const whatsapp = text(formData, 'whatsapp', 30);
  if (!name) go(back, 'error', 'invalid_name');
  if ((phone && !isValidPhone(phone)) || (whatsapp && !isValidPhone(whatsapp))) go(back, 'error', 'invalid_phone');
  const { error } = await supabase.rpc('update_my_account', {
    p_company_id: id,
    p_name: name,
    p_contact_name: text(formData, 'contact_name', 100),
    p_phone: phone,
    p_whatsapp: whatsapp,
    p_email_monthly_summary: formData.get('email_monthly_summary') === 'on',
    p_email_review_alerts: formData.get('email_review_alerts') === 'on',
  });
  if (error) go(back, 'error', errorCode(error));
  revalidatePath('/dashboard', 'layout');
  go(back, 'ok', 'account');
}

// Changing the login email: Supabase sends a confirmation link to the new address. The account
// follows the new address at the next login (claim_account), never before it is confirmed.
export async function changeLoginEmail(formData) {
  const { supabase, user } = await session();
  const back = '/dashboard/account';
  const email = text(formData, 'email', 254).toLowerCase();
  if (!isValidEmail(email)) go(back, 'error', 'invalid_email');
  if (email === String(user.email || '').toLowerCase()) go(back, 'ok', 'account');
  const { error } = await supabase.auth.updateUser({ email }, { emailRedirectTo: `${siteUrl()}/auth/callback?next=/dashboard/account` });
  if (error) go(back, 'error', /registered|exists|already/i.test(error.message) ? 'email_in_use' : 'email_failed');
  go(back, 'ok', 'email');
}

export async function sendSupportRequest(formData) {
  const { supabase, user } = await session();
  const back = '/dashboard/help';
  const topic = text(formData, 'topic', 60) || 'Question';
  const message = text(formData, 'message', 3000);
  if (message.length < 5) go(back, 'error', 'invalid_message');
  const { error } = await supabase.rpc('create_support_request', { p_topic: topic, p_message: message });
  if (error) go(back, 'error', errorCode(error));
  // Best effort: the request is saved either way and visible in the admin.
  await notifySupport({ from: user.email, topic, message }).catch(() => {});
  go(back, 'ok', 'support');
}

export async function saveLinkPage(formData) {
  const { supabase } = await session();
  const id = text(formData, 'business_id', 40);
  const back = `/dashboard/links?location=${id}`;
  if (!isUuid(id)) redirect('/dashboard/links');
  let list = [];
  try {
    list = JSON.parse(String(formData.get('links') || '[]'));
  } catch {
    go(back, 'error', 'invalid_links');
  }
  const result = normalizeLinks(list);
  if (!result.ok) redirect(`${back}&error=invalid_links&detail=${encodeURIComponent(result.error)}`);
  const { error } = await supabase.rpc('save_link_page', {
    p_business_id: id,
    p_headline: text(formData, 'headline', 120),
    p_links: result.links,
    p_published: formData.get('published') === 'on',
  });
  if (error) go(back, 'error', errorCode(error));
  revalidatePath('/dashboard/links');
  go(back, 'ok', 'links');
}
