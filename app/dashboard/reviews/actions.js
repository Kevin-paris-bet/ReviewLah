'use server';
// Review replies. A reply reaches Google in one way only: the owner presses "Approve and publish"
// on text they can see and edit. AI drafts are saved as drafts and never published by themselves.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { gbpEnabled } from '../../../lib/env';
import { adminClient } from '../../../lib/supabase/admin';
import { errorCode } from '../../../lib/dashboard';
import { isUuid } from '../../../lib/validation';
import { session, go, text } from '../../../lib/action-helpers';
import { draftReply, DRAFT_LANGUAGES } from '../../../lib/ai/drafts';
import { updateReply, deleteReply as deleteGoogleReply } from '../../../lib/google/api';
import { accessTokenFor, loadConnection } from '../../../lib/google/sync';

function backPath(formData, reviewId) {
  const raw = String(formData.get('back') || '');
  const path = /^\/dashboard\/reviews(\?[A-Za-z0-9\-_=&]*)?$/.test(raw) ? raw : '/dashboard/reviews';
  return { path, anchor: isUuid(reviewId) ? `#r-${reviewId}` : '' };
}

function done(back, kind, code) {
  redirect(`${back.path}${back.path.includes('?') ? '&' : '?'}${kind}=${encodeURIComponent(code)}${back.anchor}`);
}

// Row level security returns the review only to the owner of a Pro location (or an admin).
async function loadReview(supabase, formData) {
  if (!gbpEnabled()) redirect('/dashboard');
  const id = text(formData, 'review_id', 40);
  const back = backPath(formData, id);
  if (!isUuid(id)) done(back, 'error', 'not_found');
  const { data: review } = await supabase.from('google_reviews').select('id,business_id,resource_name,rating,comment,reply_comment').eq('id', id).maybeSingle();
  if (!review) done(back, 'error', 'not_allowed');
  const { data: business } = await supabase.from('businesses').select('id,name,company_id').eq('id', review.business_id).maybeSingle();
  if (!business) done(back, 'error', 'not_allowed');
  return { review, business, back };
}

export async function generateDraft(formData) {
  const { supabase } = await session();
  const { review, business, back } = await loadReview(supabase, formData);
  const language = DRAFT_LANGUAGES[text(formData, 'language', 5)] ? text(formData, 'language', 5) : 'en';
  const draft = await draftReply({ rating: review.rating, comment: review.comment, businessName: business.name, language });
  if (!draft.ok) done(back, 'error', draft.error === 'ai_unavailable' ? 'ai_unavailable' : 'failed');
  const { error } = await supabase.rpc('save_reply_draft', { p_review_id: review.id, p_body: draft.text, p_language: language, p_source: 'ai', p_model: draft.model });
  if (error) done(back, 'error', errorCode(error));
  revalidatePath('/dashboard/reviews');
  done(back, 'ok', 'drafted');
}

export async function saveDraft(formData) {
  const { supabase } = await session();
  const { review, back } = await loadReview(supabase, formData);
  const { error } = await supabase.rpc('save_reply_draft', {
    p_review_id: review.id, p_body: text(formData, 'body', 4100), p_language: text(formData, 'language', 5) || 'en', p_source: 'manual', p_model: null,
  });
  if (error) done(back, 'error', errorCode(error));
  revalidatePath('/dashboard/reviews');
  done(back, 'ok', 'saved');
}

export async function discardDraft(formData) {
  const { supabase } = await session();
  const { review, back } = await loadReview(supabase, formData);
  const { error } = await supabase.rpc('discard_reply_draft', { p_review_id: review.id });
  if (error) done(back, 'error', errorCode(error));
  revalidatePath('/dashboard/reviews');
  done(back, 'ok', 'discarded');
}

async function googleToken(business, back) {
  const admin = adminClient();
  if (!admin) done(back, 'error', 'config');
  const connection = await loadConnection(admin, business.company_id);
  const token = connection && connection.status === 'active' ? await accessTokenFor(admin, connection) : null;
  if (!token) done(back, 'error', 'google_failed');
  return { admin, token };
}

// The owner approved the text shown in the form: publish exactly that text with reviews.updateReply.
export async function publishReply(formData) {
  const { supabase, user } = await session();
  const { review, business, back } = await loadReview(supabase, formData);
  const body = text(formData, 'body', 4100);
  if (!body) done(back, 'error', 'reply_empty');
  if (body.length > 4000) done(back, 'error', 'reply_long');
  const { admin, token } = await googleToken(business, back);
  let published;
  try {
    published = await updateReply(token, review.resource_name, body);
  } catch (e) {
    console.error('[reviews] reply not published', e?.status, e?.message);
    done(back, 'error', 'google_failed');
  }
  const { error } = await admin.rpc('google_set_reply', { p_review_id: review.id, p_comment: published.comment, p_time: published.updateTime, p_actor: user.id });
  if (error) done(back, 'error', 'failed');
  revalidatePath('/dashboard/reviews');
  done(back, 'ok', 'published');
}

export async function deleteReply(formData) {
  const { supabase, user } = await session();
  const { review, business, back } = await loadReview(supabase, formData);
  const { admin, token } = await googleToken(business, back);
  try {
    await deleteGoogleReply(token, review.resource_name);
  } catch (e) {
    console.error('[reviews] reply not deleted', e?.status, e?.message);
    done(back, 'error', 'google_failed');
  }
  const { error } = await admin.rpc('google_set_reply', { p_review_id: review.id, p_comment: null, p_time: null, p_actor: user.id });
  if (error) done(back, 'error', 'failed');
  revalidatePath('/dashboard/reviews');
  done(back, 'ok', 'reply_deleted');
}
