// Renders every page of the app against the local Supabase stand-in (real SQL, demo data) and
// checks that each one answers correctly for the right person: owner, second customer, new login,
// admin, visitor. Catches broken pages and broken access rules before a deployment.
//
//   npm run smoke:app            (builds, then checks)
//   npm run smoke:app -- --keep  (leaves the app running on http://localhost:3998 for manual checks)
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { startDevSupabase, seedDemo, devSessionCookie, DEV_URL, ANON_KEY, SERVICE_KEY } from './dev-supabase.mjs';

const NEXT_BIN = 'node_modules/next/dist/bin/next';
const PORT = 3998;
const BASE = `http://localhost:${PORT}`;
const KEEP = process.argv.includes('--keep');
const SKIP_BUILD = process.argv.includes('--no-build');

const env = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: DEV_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ANON_KEY,
  SUPABASE_SECRET_KEY: SERVICE_KEY,
  NEXT_PUBLIC_SITE_URL: BASE,
  NEXT_PUBLIC_GO_URL: 'https://go.reviewlah.my',
  CRON_SECRET: 'dev-cron',
  SUPPORT_EMAIL: 'hello@reviewlah.my',
  SUPPORT_WHATSAPP: '+60 11-1234 5678',
  NEXT_TELEMETRY_DISABLED: '1',
  PAYMENT_PROVIDER: 'airwallex',
  AIRWALLEX_CLIENT_ID: 'dev-client',
  AIRWALLEX_API_KEY: 'dev-key',
  AIRWALLEX_WEBHOOK_SECRET: 'dev-webhook-secret',
  AIRWALLEX_PRICE_MONTHLY: 'pri_dev_month',
  AIRWALLEX_PRICE_YEARLY: 'pri_dev_year',
  AIRWALLEX_API_URL: 'http://127.0.0.1:9',
  ...(process.env.SMOKE_GBP ? { GBP_ENABLED: 'true' } : {}),
};

let app;
let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
};

async function get(path, user, init = {}) {
  const headers = { ...(init.headers || {}) };
  if (user) {
    const cookie = devSessionCookie(user);
    headers.cookie = `${cookie.name}=${cookie.value}`;
  }
  const response = await fetch(`${BASE}${path}`, { redirect: 'manual', ...init, headers });
  const text = await response.text();
  return { status: response.status, location: response.headers.get('location'), type: response.headers.get('content-type') || '', disposition: response.headers.get('content-disposition') || '', text };
}

async function page(label, path, user, expects = [], rejects = []) {
  const r = await get(path, user);
  const missing = expects.filter((e) => !r.text.includes(e));
  const present = ['Application error', 'Internal Server Error', ...rejects].filter((e) => r.text.includes(e));
  check(`${label} (${path})`, r.status === 200 && missing.length === 0 && present.length === 0,
    r.status !== 200 ? `status ${r.status}${r.location ? ` → ${r.location}` : ''}` : [missing.length ? `missing: ${missing.join(' | ')}` : '', present.length ? `unexpected: ${present.join(' | ')}` : ''].filter(Boolean).join('; '));
  return r;
}

async function main() {
  if (!SKIP_BUILD) {
    console.log('Building the app against the local Supabase stand-in…');
    const build = spawnSync(process.execPath, [NEXT_BIN, 'build'], { env, encoding: 'utf8' });
    if (build.status !== 0) throw new Error(`Build failed:\n${build.stdout}\n${build.stderr}`);
  }
  const supabase = await startDevSupabase();
  const demo = await seedDemo(supabase.db);
  app = spawn(process.execPath, [NEXT_BIN, 'start', '-p', String(PORT)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  app.stderr.on('data', (chunk) => { stderr += chunk; });
  for (let i = 0; i < 60; i += 1) {
    try { await fetch(`${BASE}/login`, { signal: AbortSignal.timeout(1000) }); break; } catch { await sleep(500); }
  }
  const { owner, other, newcomer, admin, bangsar, ttdi, salon } = demo;

  const checks = (await import('./app-smoke-checks.mjs')).default;
  await checks({ page, get, check, demo, supabase, owner, other, newcomer, admin, bangsar, ttdi, salon, BASE, env });

  if (stderr.trim()) console.log(`\nServer errors logged:\n${stderr.trim().split('\n').slice(0, 30).join('\n')}`);
  if (KEEP) {
    console.log(`\nApp left running on ${BASE}. Cookies:`);
    const cookies = {};
    for (const [name, user] of Object.entries({ owner, admin, other, newcomer })) {
      const c = devSessionCookie(user);
      cookies[name] = c;
      console.log(`  ${name}: ${c.name}=${c.value}`);
    }
    const ids = { bangsar: bangsar.business_id, ttdi: ttdi.business_id, salon: salon.business_id, company: bangsar.company_id };
    writeFileSync(process.env.SMOKE_STATE || '/tmp/reviewlah-dev.json', JSON.stringify({ base: BASE, cookies, ids }, null, 2));
    await new Promise(() => {});
  }
  await supabase.close();
}

main()
  .catch((error) => { failures += 1; console.error(error); })
  .finally(() => {
    if (app && !KEEP) app.kill('SIGKILL');
    console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
    process.exit(failures ? 1 : 0);
  });
