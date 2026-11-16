// Vercel Cron calls our scheduled routes with "Authorization: Bearer <CRON_SECRET>".
// Without CRON_SECRET configured the routes refuse to run (they are never left open).
import { timingSafeEqual } from 'node:crypto';
import { cronSecret } from './env';

export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

export function cronAuthorized(request) {
  const secret = cronSecret();
  if (!secret) return false;
  return safeEqual(request.headers.get('authorization') || '', `Bearer ${secret}`);
}
