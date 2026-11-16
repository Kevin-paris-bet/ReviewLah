import { NextResponse } from 'next/server';
import { createClient } from '../../../../lib/supabase/server';
import { adminClient } from '../../../../lib/supabase/admin';
import { providerByName } from '../../../../lib/payments';
import { notifyBillingChange } from '../../../../lib/email/billing';
import { isUuid } from '../../../../lib/validation';

export const dynamic = 'force-dynamic';

// The customer comes back here from the hosted payment page. The address proves nothing by
// itself: the state of each pending checkout is read from the payment provider, server to server,
// and applied exactly like a webhook. If the provider cannot be reached, the webhook does the job.
export async function GET(request) {
  const url = new URL(request.url);
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return NextResponse.redirect(new URL('/login', request.url));

  const admin = adminClient();
  const { data: pending } = await supabase.from('subscriptions').select('id,provider,provider_checkout_id').eq('status', 'incomplete');
  for (const row of (pending || []).slice(0, 5)) {
    const provider = providerByName(row.provider);
    if (!admin || !provider || !row.provider_checkout_id) continue;
    try {
      const event = await provider.fetchCheckout(row.provider_checkout_id);
      if (!event) continue;
      const { data, error } = await admin.rpc('billing_apply_event', {
        p_provider: provider.name, p_event_id: event.id, p_event_type: event.type, p_payload: event.payload, p_normalized: event.normalized,
      });
      if (!error) await notifyBillingChange(admin, data).catch(() => {});
    } catch (e) {
      console.error('[billing] checkout not reconciled', e?.message);
    }
  }
  const location = url.searchParams.get('location');
  return NextResponse.redirect(new URL(`/dashboard/billing?ok=paid${isUuid(location) ? `&location=${location}` : ''}`, request.url));
}
