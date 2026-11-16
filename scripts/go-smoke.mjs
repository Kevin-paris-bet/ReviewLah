// End-to-end check of the plate redirect (go.reviewlah.my/CODE) against a fake database API.
// It builds the app pointed at a local mock of the Supabase REST API, starts it, and verifies that
// a customer always lands on the Google review page — including before a migration is applied
// and while the database is down.
//
//   npm run smoke:go
//
// Nothing here touches the real database.
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const NEXT_BIN = 'node_modules/next/dist/bin/next';
const MOCK_PORT = 54399;
const APP_PORT = 3999;
const GOOGLE = 'https://search.google.com/local/writereview?placeid=TEST';
const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';

const state = { mode: 'migrated', calls: [] };
const plates = { GOOD1: GOOGLE };

const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    const url = new URL(req.url, 'http://mock');
    const name = url.pathname.replace('/rest/v1/rpc/', '');
    const args = req.method === 'GET' ? Object.fromEntries(url.searchParams) : JSON.parse(body || '{}');
    state.calls.push({ method: req.method, name, args });
    const send = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    if (state.mode === 'down') return send(503, { message: 'unavailable' });
    if (state.mode === 'hang') return undefined; // never answers
    const unknown = () => send(404, { code: 'PGRST202', message: 'Could not find the function' });
    if (name === 'record_scan') {
      if (state.mode === 'legacy' && 'p_device' in args) return unknown();
      return send(200, plates[String(args.p_code).toUpperCase()] ?? null);
    }
    if (name === 'plate_destination') {
      if (state.mode === 'legacy') return unknown();
      return send(200, plates[String(args.p_code).toUpperCase()] ?? null);
    }
    return unknown();
  });
});

const env = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-key',
  NEXT_PUBLIC_SITE_URL: 'https://www.reviewlah.my',
  NEXT_TELEMETRY_DISABLED: '1',
};

let app;
async function startApp() {
  app = spawn(process.execPath, [NEXT_BIN, 'start', '-p', String(APP_PORT)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  app.stderr.on('data', () => {});
  for (let i = 0; i < 60; i += 1) {
    try {
      await fetch(`http://127.0.0.1:${APP_PORT}/login`, { signal: AbortSignal.timeout(1000) });
      return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error('The app did not start.');
}
async function stopApp() {
  if (!app || app.exitCode !== null) return;
  const exited = new Promise((resolve) => app.once('exit', resolve));
  app.kill('SIGTERM');
  const timer = setTimeout(() => app.kill('SIGKILL'), 5000);
  await exited;
  clearTimeout(timer);
  await sleep(300);
}

// node:http rather than fetch, so that the Host header can be set (go.reviewlah.my).
function tap(path, headers = {}) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: '127.0.0.1', port: APP_PORT, path, method: 'GET', headers: { 'user-agent': PHONE, 'x-forwarded-for': '203.0.113.7', ...headers } },
      (response) => {
        // Timed at the response headers: that is when a browser follows the redirect.
        const ms = Date.now() - started;
        response.resume();
        response.on('end', () => resolve({
          status: response.statusCode, location: response.headers.location || null,
          ms, endMs: Date.now() - started, cache: response.headers['cache-control'] || null,
        }));
      },
    );
    request.on('error', reject);
    request.end();
  });
}

let failures = 0;
function check(label, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
}
const lastCalls = () => state.calls.splice(0);

async function main() {
  console.log('Building the app against the mock database API…');
  const build = spawnSync(process.execPath, [NEXT_BIN, 'build'], { env, encoding: 'utf8' });
  if (build.status !== 0) throw new Error(`Build failed:\n${build.stdout}\n${build.stderr}`);
  await new Promise((resolve) => mock.listen(MOCK_PORT, '127.0.0.1', resolve));
  await startApp();
  const HOME = 'https://www.reviewlah.my/';

  let r = await tap('/go/GOOD1?nfc');
  let calls = lastCalls().filter((c) => c.method === 'POST');
  check('NFC tap is redirected to the Google review page', r.status === 302 && r.location === GOOGLE, `${r.status} ${r.location} in ${r.ms} ms`);
  check('…with a single database call that counts the scan as nfc', calls.length === 1 && calls[0].name === 'record_scan' && calls[0].args.p_source === 'nfc');
  check('…sending a fingerprint, never the IP address', /^[0-9a-f]{32}$/.test(calls[0]?.args.p_device || '') && !JSON.stringify(calls[0]?.args).includes('203.0.113.7'));
  check('…and the redirect is not cacheable', r.cache === 'no-store');

  r = await tap('/go/good1?qr');
  calls = lastCalls().filter((c) => c.method === 'POST');
  check('QR scan with a lower-case code works and counts as qr', r.location === GOOGLE && calls[0]?.args.p_source === 'qr' && calls[0]?.args.p_code === 'GOOD1');

  r = await tap('/GOOD1?nfc', { host: 'go.reviewlah.my' });
  check('go.reviewlah.my/CODE (the address on the plate) works', r.status === 302 && r.location === GOOGLE);
  lastCalls();

  r = await tap('/go/GOOD1?qr', { 'user-agent': 'WhatsApp/2.23.20.0' });
  calls = lastCalls().filter((c) => c.method === 'POST');
  check('a link preview is redirected but not counted', r.location === GOOGLE && calls.length === 1 && calls[0].name === 'plate_destination');

  r = await tap('/go/GOOD1?nfc', { 'sec-purpose': 'prefetch' });
  calls = lastCalls().filter((c) => c.method === 'POST');
  check('a browser prefetch is not counted', r.location === GOOGLE && calls.every((c) => c.name === 'plate_destination'));

  r = await tap('/go/NOPE9?nfc');
  check('an unknown plate goes to the ReviewLah site', r.status === 302 && r.location === HOME);
  lastCalls();

  r = await tap('/go/bad%20code!');
  check('an invalid code never reaches the database', r.location === HOME && lastCalls().length === 0);

  state.mode = 'legacy';
  r = await tap('/go/GOOD1?nfc');
  calls = lastCalls().filter((c) => c.method === 'POST');
  check('before the migration is applied, the previous database function is used', r.location === GOOGLE && calls.at(-1)?.name === 'record_scan' && !('p_device' in calls.at(-1).args));

  state.mode = 'down';
  r = await tap('/go/GOOD1?nfc');
  check('database down: the customer still lands on Google', r.status === 302 && r.location === GOOGLE, `${r.ms} ms`);
  await sleep(300);
  check('…and the scan is retried once after the response', lastCalls().filter((c) => c.name === 'record_scan' && 'p_device' in c.args).length === 2);

  state.mode = 'hang';
  r = await tap('/go/GOOD1?qr');
  check('database not answering: still redirected, within 2.5 seconds', r.location === GOOGLE && r.ms < 2500, `headers after ${r.ms} ms, connection closed after ${r.endMs} ms`);
  await sleep(2500); // lets the background retry time out before the next check
  lastCalls();

  // A fresh server instance (empty memory) while the database is still down:
  // the destination must come from the shared data cache.
  state.mode = 'down';
  await stopApp();
  await startApp();
  r = await tap('/go/GOOD1?nfc');
  check('database down on a cold server: the cached destination is used', r.status === 302 && r.location === GOOGLE, `${r.status} ${r.location}`);

  state.mode = 'migrated';
  r = await tap('/go/GOOD1?nfc');
  check('database back: scans are counted again', r.location === GOOGLE && lastCalls().some((c) => c.name === 'record_scan'));
}

main()
  .catch((error) => { failures += 1; console.error(error); })
  .finally(async () => {
    await stopApp();
    mock.close();
    console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
    process.exit(failures ? 1 : 0);
  });
