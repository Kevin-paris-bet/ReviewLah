import { NextResponse } from 'next/server';
import { adminClient } from '../../../../lib/supabase/admin';
import { gbpEnabled, googleConfig } from '../../../../lib/env';
import { verifyPushToken, parsePushMessage } from '../../../../lib/google/pubsub';
import { handleReviewNotification } from '../../../../lib/google/sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Pub/Sub push endpoint: Google announces "new review" / "updated review" for a listing.
// The message is trusted only after its OIDC token is verified (Google signature, our audience,
// our service account). The message itself carries no review content: we then read the reviews
// of that listing from the API. A failure answers 5xx so that Pub/Sub delivers again later.
export async function POST(request) {
  if (!gbpEnabled()) return new NextResponse('Not found', { status: 404 });
  const config = googleConfig();
  const check = await verifyPushToken(request.headers.get('authorization'), {
    audience: config.pubsubAudience, serviceAccount: config.pubsubServiceAccount,
  });
  if (!check.ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const admin = adminClient();
  if (!admin) return NextResponse.json({ error: 'server not configured' }, { status: 503 });

  const note = parsePushMessage(await request.json().catch(() => null));
  if (!note) return new NextResponse(null, { status: 204 }); // nothing we can use: acknowledge
  try {
    await handleReviewNotification(admin, note);
  } catch (e) {
    console.error('[google] notification not handled', e?.message);
    return NextResponse.json({ error: 'retry' }, { status: 500 });
  }
  return new NextResponse(null, { status: 204 });
}
