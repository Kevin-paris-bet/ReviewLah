import { NextResponse, after } from 'next/server';
import { adminClient } from '../../../../lib/supabase/admin';
import { providerByName } from '../../../../lib/payments';
import { notifyBillingChange } from '../../../../lib/email/billing';

export const dynamic = 'force-dynamic';

// Payment provider webhooks: /api/webhooks/airwallex
// 1. the signature is verified on the raw body, before anything is parsed;
// 2. the adapter turns the event into the provider-agnostic shape;
// 3. billing_apply_event stores the event once (a redelivery is a no-op) and updates the
//    subscription or the payment. Pro is granted here and nowhere else.
// Any failure answers with an error status so that the provider delivers the event again.
export async function POST(request, { params }) {
  const { provider: name } = await params;
  const provider = providerByName(name);
  if (!provider || !provider.canReceiveWebhooks()) return NextResponse.json({ error: 'unknown provider' }, { status: 404 });

  const rawBody = await request.text();
  if (!provider.verifyWebhook({ rawBody, headers: request.headers })) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }
  const admin = adminClient();
  if (!admin) return NextResponse.json({ error: 'server not configured' }, { status: 503 });

  let event;
  try {
    event = provider.parseWebhook(rawBody);
  } catch {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }

  const { data, error } = await admin.rpc('billing_apply_event', {
    p_provider: provider.name,
    p_event_id: event.id,
    p_event_type: event.type,
    p_payload: event.payload,
    p_normalized: event.normalized,
  });
  if (error) {
    console.error('[webhook] billing_apply_event failed', provider.name, event.id, error.message);
    return NextResponse.json({ error: 'not applied' }, { status: 500 });
  }
  after(() => notifyBillingChange(admin, data).catch((e) => console.error('[webhook] email failed', e?.message)));
  return NextResponse.json({ received: true, outcome: data?.outcome || null });
}
