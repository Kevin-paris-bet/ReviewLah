'use server';
// Admin actions. Every database function called here checks public.is_admin() itself, and direct
// table writes are limited to admins by row level security: a non-admin calling these gets nothing.
import { redirect } from 'next/navigation';
import { revalidatePath, revalidateTag } from 'next/cache';
import { errorCode } from '../../lib/dashboard';
import { validateReviewUrl, isValidEmail, isUuid, isDateKey } from '../../lib/validation';
import { session, go, text } from '../../lib/action-helpers';
import { adminClient } from '../../lib/supabase/admin';
import { providerByName } from '../../lib/payments';
import { sendMonthlySummaries } from '../../lib/email/summaries';
import { previousMonthKey } from '../../lib/time';

const customerPath = (id) => `/admin/customers/${id}`;

async function refreshPlates(supabase, businessId) {
  const { data } = await supabase.from('plates').select('code').eq('business_id', businessId);
  for (const plate of data || []) revalidateTag(`plate:${plate.code}`, 'max');
}

// Company + location + plates (+ Pro) in one go. With company_id, adds a location to that customer.
export async function createBundle(formData) {
  const { supabase } = await session();
  const companyId = text(formData, 'company_id', 40);
  const back = isUuid(companyId) ? customerPath(companyId) : '/admin';
  const email = text(formData, 'owner_email', 254).toLowerCase();
  const check = validateReviewUrl(formData.get('review_url'));
  if (!check.ok) go(back, 'error', 'invalid_review_url');
  if (email && !isValidEmail(email)) go(back, 'error', 'invalid_email');
  const until = text(formData, 'pro_until', 10);
  const { data, error } = await supabase.rpc('admin_create_bundle', {
    p_company_name: text(formData, 'company_name', 100),
    p_owner_email: email || null,
    p_contact_name: text(formData, 'contact_name', 100) || null,
    p_phone: text(formData, 'phone', 30) || null,
    p_business_name: text(formData, 'business_name', 100),
    p_address: text(formData, 'address', 200) || null,
    p_review_url: check.url,
    p_plate_count: Math.max(0, Math.min(50, Number(formData.get('plate_count')) || 0)),
    p_plate_label: text(formData, 'plate_label', 40) || null,
    p_pro: formData.get('pro') === 'on',
    p_pro_until: isDateKey(until) ? until : null,
    p_company_id: isUuid(companyId) ? companyId : null,
  });
  if (error) go(back, 'error', errorCode(error));
  revalidatePath('/admin', 'layout');
  const codes = (data.plates || []).map((p) => p.code).join(',');
  redirect(`${customerPath(data.company_id)}?ok=created${codes ? `&new=${codes}` : ''}`);
}

export async function addPlates(formData) {
  const { supabase } = await session();
  const companyId = text(formData, 'company_id', 40);
  const businessId = text(formData, 'business_id', 40);
  const back = customerPath(companyId);
  if (!isUuid(companyId) || !isUuid(businessId)) redirect('/admin/customers');
  const { data, error } = await supabase.rpc('admin_add_plates', {
    p_business_id: businessId, p_count: Math.max(1, Math.min(50, Number(formData.get('count')) || 1)), p_label: text(formData, 'label', 40) || null,
  });
  if (error) go(back, 'error', errorCode(error));
  revalidatePath('/admin', 'layout');
  redirect(`${back}?ok=created&new=${(data.plates || []).map((p) => p.code).join(',')}`);
}

export async function setPro(formData) {
  const { supabase } = await session();
  const companyId = text(formData, 'company_id', 40);
  const businessId = text(formData, 'business_id', 40);
  const back = isUuid(companyId) ? customerPath(companyId) : '/admin/subscriptions';
  if (!isUuid(businessId)) redirect(back);
  const enabled = formData.get('enabled') === 'true';
  const until = text(formData, 'until', 10);
  const { error } = await supabase.rpc('admin_set_pro', { p_business_id: businessId, p_enabled: enabled, p_until: enabled && isDateKey(until) ? until : null });
  if (error) go(back, 'error', errorCode(error));
  revalidatePath('/admin', 'layout');
  go(back, 'ok', enabled ? 'pro_on' : 'pro_off');
}

// Paid subscription: stop or resume the renewal at the provider, or end it at once.
export async function manageSubscription(formData) {
  const { supabase } = await session();
  const companyId = text(formData, 'company_id', 40);
  const id = text(formData, 'subscription_id', 40);
  const mode = text(formData, 'mode', 10); // cancel | resume | end
  const back = isUuid(companyId) ? customerPath(companyId) : '/admin/subscriptions';
  if (!isUuid(id)) redirect(back);
  const { data: admin } = await supabase.rpc('is_admin');
  if (admin !== true) go(back, 'error', 'not_allowed');
  const { data: sub } = await supabase.from('subscriptions').select('id,provider,provider_subscription_id').eq('id', id).maybeSingle();
  const provider = providerByName(sub?.provider);
  if (!sub || !provider || !sub.provider_subscription_id) go(back, 'error', 'not_found');
  try {
    if (mode === 'end') await provider.cancelNow(sub.provider_subscription_id);
    else await provider.setCancelAtPeriodEnd(sub.provider_subscription_id, mode === 'cancel');
  } catch (e) {
    console.error('[admin] subscription change failed', e?.message);
    go(back, 'error', 'provider_unreachable');
  }
  if (mode !== 'end') {
    const { error } = await supabase.rpc('billing_set_cancel', { p_subscription_id: id, p_cancel: mode === 'cancel' });
    if (error) go(back, 'error', errorCode(error));
  }
  revalidatePath('/admin', 'layout');
  go(back, 'ok', mode === 'resume' ? 'resume' : mode === 'end' ? 'saved' : 'cancel');
}

export async function updateCompany(formData) {
  const { supabase } = await session();
  const id = text(formData, 'company_id', 40);
  if (!isUuid(id)) redirect('/admin/customers');
  const back = customerPath(id);
  const { error } = await supabase.rpc('update_my_account', {
    p_company_id: id,
    p_name: text(formData, 'name', 100),
    p_contact_name: text(formData, 'contact_name', 100),
    p_phone: text(formData, 'phone', 30),
    p_whatsapp: text(formData, 'whatsapp', 30),
    p_email_monthly_summary: null,
    p_email_review_alerts: null,
  });
  if (error) go(back, 'error', errorCode(error));
  const notes = await supabase.from('companies').update({ admin_notes: text(formData, 'admin_notes', 2000) || null }).eq('id', id);
  if (notes.error) go(back, 'error', 'failed');
  revalidatePath('/admin', 'layout');
  go(back, 'ok', 'saved');
}

export async function setCompanyEmail(formData) {
  const { supabase } = await session();
  const id = text(formData, 'company_id', 40);
  if (!isUuid(id)) redirect('/admin/customers');
  const back = customerPath(id);
  const email = text(formData, 'email', 254).toLowerCase();
  if (email && !isValidEmail(email)) go(back, 'error', 'invalid_email');
  const { error } = await supabase.rpc('admin_set_company_email', { p_company_id: id, p_email: email || null });
  if (error) go(back, 'error', errorCode(error));
  revalidatePath('/admin', 'layout');
  go(back, 'ok', 'saved');
}

export async function updateLocation(formData) {
  const { supabase } = await session();
  const companyId = text(formData, 'company_id', 40);
  const businessId = text(formData, 'business_id', 40);
  if (!isUuid(companyId) || !isUuid(businessId)) redirect('/admin/customers');
  const back = customerPath(companyId);
  const details = await supabase.rpc('update_business_details', { p_business_id: businessId, p_name: text(formData, 'name', 100), p_address: text(formData, 'address', 200) });
  if (details.error) go(back, 'error', errorCode(details.error));
  const url = text(formData, 'review_url', 600);
  if (url && url !== text(formData, 'current_review_url', 600)) {
    const check = validateReviewUrl(url);
    if (!check.ok) go(back, 'error', 'invalid_review_url');
    const { error } = await supabase.rpc('update_business_review_url', { p_business_id: businessId, p_url: check.url });
    if (error) go(back, 'error', errorCode(error));
    await refreshPlates(supabase, businessId);
  }
  revalidatePath('/admin', 'layout');
  go(back, 'ok', 'saved');
}

export async function updatePlate(formData) {
  const { supabase } = await session();
  const companyId = text(formData, 'company_id', 40);
  const plateId = text(formData, 'plate_id', 40);
  const back = isUuid(companyId) ? customerPath(companyId) : '/admin/plates';
  if (!isUuid(plateId)) redirect(back);
  const mode = text(formData, 'mode', 10); // label | pause | resume | move | delete
  let result = { error: null };
  if (mode === 'label') result = await supabase.rpc('update_plate_label', { p_plate_id: plateId, p_label: text(formData, 'label', 40) });
  else if (mode === 'pause' || mode === 'resume') {
    result = await supabase.from('plates').update({ active: mode === 'resume' }).eq('id', plateId).select('code');
    if (!result.error && !(result.data || []).length) result = { error: { message: 'not_allowed' } };
    for (const plate of result.data || []) revalidateTag(`plate:${plate.code}`, 'max');
  } else if (mode === 'move') {
    const target = text(formData, 'target_business_id', 40);
    if (!isUuid(target)) go(back, 'error', 'not_found');
    result = await supabase.rpc('admin_move_plate', { p_plate_id: plateId, p_business_id: target });
    if (!result.error) await refreshPlates(supabase, target);
  } else if (mode === 'delete') result = await supabase.rpc('admin_delete_plate', { p_plate_id: plateId });
  if (result.error) go(back, 'error', errorCode(result.error));
  revalidatePath('/admin', 'layout');
  go(back, 'ok', mode === 'move' ? 'moved' : mode === 'delete' ? 'deleted' : 'saved');
}

export async function closeSupportRequest(formData) {
  const { supabase } = await session();
  const id = text(formData, 'id', 40);
  if (!isUuid(id)) redirect('/admin/support');
  const { error } = await supabase.from('support_requests').update({ status: formData.get('reopen') ? 'open' : 'closed' }).eq('id', id);
  if (error) go('/admin/support', 'error', 'failed');
  revalidatePath('/admin', 'layout');
  go('/admin/support', 'ok', formData.get('reopen') ? 'saved' : 'closed');
}

// Sends last month's summary of one customer to the admin's own inbox (a test, never logged as sent).
export async function sendTestSummary(formData) {
  const { supabase, user } = await session();
  const id = text(formData, 'company_id', 40);
  if (!isUuid(id)) redirect('/admin/customers');
  const back = customerPath(id);
  const { data: isAdmin } = await supabase.rpc('is_admin');
  if (isAdmin !== true) go(back, 'error', 'not_allowed');
  const admin = adminClient();
  if (!admin) go(back, 'error', 'config');
  const result = await sendMonthlySummaries(admin, { month: previousMonthKey(), companyId: id, force: true, to: user.email });
  if (result.sent > 0) go(back, 'ok', 'sent');
  redirect(`${back}?error=failed&detail=${encodeURIComponent(result.skipped || result.error || (result.candidates === 0 ? 'No Pro location for this customer last month, or the monthly summary is switched off.' : 'The email could not be sent.'))}`);
}

// Runs the daily maintenance now (same as the scheduled job, without the monthly email).
export async function runMaintenance() {
  const { supabase } = await session();
  const back = '/admin/system';
  const { data: isAdmin } = await supabase.rpc('is_admin');
  if (isAdmin !== true) go(back, 'error', 'not_allowed');
  const admin = adminClient();
  if (!admin) go(back, 'error', 'config');
  const { error } = await admin.rpc('maintenance_daily');
  if (error) go(back, 'error', 'failed');
  revalidatePath('/admin', 'layout');
  go(back, 'ok', 'saved');
}
