// A local stand-in for Supabase, for development and for the page smoke test.
// It runs the real SQL (supabase/schema.sql + every migration) in an in-memory PostgreSQL (PGlite)
// and answers the small part of the Supabase HTTP API that the app uses:
//   /auth/v1/user, /auth/v1/logout, /auth/v1/otp
//   /rest/v1/rpc/<function>   (as anon, as a signed-in user, or as the service role)
//   /rest/v1/<table>          (simple selects, inserts, updates and deletes)
// Row level security applies exactly as in production, because requests run under the same roles.
//
//   node scripts/dev-supabase.mjs            → API on http://localhost:54399 with demo data
//
// Then, in another terminal:
//   NEXT_PUBLIC_SUPABASE_URL=http://localhost:54399 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=dev-anon \
//   SUPABASE_SECRET_KEY=dev-service npm run dev
// and open the login addresses printed by this script.
//
// Nothing here is used in production, and nothing here touches the real database.
import http from 'node:http';
import { createDb, createUser, makeAdmin } from './lib/pg.mjs';

export const DEV_PORT = 54399;
export const DEV_URL = `http://localhost:${DEV_PORT}`;
export const ANON_KEY = 'dev-anon';
export const SERVICE_KEY = 'dev-service';

const b64url = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

/** An unsigned token shaped like a Supabase access token (this mock does not verify signatures). */
export function devToken(user) {
  const exp = Math.floor(Date.now() / 1000) + 365 * 86400;
  return `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', exp })}.dev`;
}

/** The cookie that @supabase/ssr stores after a login, for this local API. */
export function devSessionCookie(user) {
  const token = devToken(user);
  const session = {
    access_token: token, token_type: 'bearer', expires_in: 365 * 86400,
    expires_at: Math.floor(Date.now() / 1000) + 365 * 86400, refresh_token: 'dev-refresh',
    user: { id: user.id, aud: 'authenticated', role: 'authenticated', email: user.email, app_metadata: {}, user_metadata: {} },
  };
  return { name: 'sb-localhost-auth-token', value: `base64-${b64url(session)}` };
}

function claimsFrom(request) {
  const auth = request.headers.authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  const apikey = request.headers.apikey || '';
  if (token === SERVICE_KEY || (apikey === SERVICE_KEY && (!token || token === SERVICE_KEY))) return { role: 'service_role', claims: { role: 'service_role' } };
  const parts = token.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      if (payload.sub) return { role: 'authenticated', claims: { sub: payload.sub, email: payload.email, role: 'authenticated' } };
    } catch { /* fall through to anon */ }
  }
  return { role: 'anon', claims: { role: 'anon' } };
}

async function runAs(db, { role, claims }, fn) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await tx.exec(`set local role ${role}`);
    return fn(tx);
  });
}

const IDENT = /^[a-z_][a-z0-9_]*$/;

function pgError(error) {
  const code = error?.code || 'XX000';
  const status = code === '42501' ? 403 : code === 'PGRST202' ? 404 : 400;
  return { status, body: { code, message: error?.message || 'error', details: error?.detail || null, hint: error?.hint || null } };
}

function encode(value) {
  return value !== null && typeof value === 'object' ? JSON.stringify(value) : value;
}

async function callFunction(db, auth, name, args) {
  if (!IDENT.test(name)) throw Object.assign(new Error('bad function name'), { code: 'PGRST202' });
  const info = await db.query(
    "select p.proretset, p.proargnames from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = $1", [name]);
  const keys = Object.keys(args);
  const match = info.rows.find((r) => keys.every((k) => (r.proargnames || []).includes(k)));
  if (!match) throw Object.assign(new Error(`Could not find the function public.${name}(${keys.join(', ')}) in the schema cache`), { code: 'PGRST202' });
  if (keys.some((k) => !IDENT.test(k))) throw Object.assign(new Error('bad argument name'), { code: 'PGRST202' });
  const params = keys.map((k, i) => `${k} => $${i + 1}`).join(', ');
  const values = keys.map((k) => encode(args[k]));
  return runAs(db, auth, async (tx) => {
    if (match.proretset) return (await tx.query(`select * from public.${name}(${params})`, values)).rows;
    return (await tx.query(`select public.${name}(${params}) as result`, values)).rows[0]?.result ?? null;
  });
}

// PostgREST filters used by the app: eq, neq, gt, gte, lt, lte, is.null, in.(a,b)
function whereClause(searchParams, values) {
  const parts = [];
  for (const [column, raw] of searchParams) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(column)) continue;
    if (!IDENT.test(column)) throw new Error(`bad column ${column}`);
    const dot = raw.indexOf('.');
    const op = raw.slice(0, dot);
    const operand = raw.slice(dot + 1);
    const ops = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };
    if (op === 'eq' || op === 'neq') {
      values.push(operand);
      parts.push(`${column}::text ${ops[op]} $${values.length}`);
    } else if (ops[op]) {
      values.push(operand);
      parts.push(`${column} ${ops[op]} $${values.length}`);
    } else if (op === 'is' && operand === 'null') {
      parts.push(`${column} is null`);
    } else if (op === 'in') {
      const list = operand.replace(/^\(|\)$/g, '').split(',').map((v) => v.replace(/^"|"$/g, ''));
      values.push(list);
      parts.push(`${column}::text = any($${values.length}::text[])`);
    } else {
      throw new Error(`unsupported filter ${column}=${raw}`);
    }
  }
  return parts.length ? ` where ${parts.join(' and ')}` : '';
}

async function tableRequest(db, auth, request, url, body) {
  const table = url.pathname.replace('/rest/v1/', '');
  if (!IDENT.test(table)) throw new Error('bad table');
  const values = [];
  const prefer = request.headers.prefer || '';
  const single = (request.headers.accept || '').includes('vnd.pgrst.object');
  const returning = prefer.includes('return=representation');
  let rows = [];
  await runAs(db, auth, async (tx) => {
    if (request.method === 'GET' || request.method === 'HEAD') {
      const select = url.searchParams.get('select') || '*';
      const columns = select === '*' ? '*' : select.split(',').map((c) => { if (!IDENT.test(c)) throw new Error(`unsupported select ${c}`); return c; }).join(', ');
      let sql = `select ${columns} from public.${table}${whereClause(url.searchParams, values)}`;
      const order = url.searchParams.get('order');
      if (order) {
        sql += ` order by ${order.split(',').map((o) => { const [c, dir] = o.split('.'); if (!IDENT.test(c)) throw new Error('bad order'); return `${c} ${dir === 'desc' ? 'desc' : 'asc'}`; }).join(', ')}`;
      }
      const limit = Number(url.searchParams.get('limit'));
      if (limit > 0) sql += ` limit ${Math.floor(limit)}`;
      rows = (await tx.query(sql, values)).rows;
    } else if (request.method === 'POST') {
      const list = Array.isArray(body) ? body : [body];
      for (const item of list) {
        const keys = Object.keys(item);
        if (keys.some((k) => !IDENT.test(k))) throw new Error('bad column');
        const result = await tx.query(
          `insert into public.${table} (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning *`, keys.map((k) => encode(item[k])));
        rows.push(...result.rows);
      }
    } else if (request.method === 'PATCH') {
      const keys = Object.keys(body);
      if (keys.some((k) => !IDENT.test(k))) throw new Error('bad column');
      keys.forEach((k) => values.push(encode(body[k])));
      const set = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
      rows = (await tx.query(`update public.${table} set ${set}${whereClause(url.searchParams, values)} returning *`, values)).rows;
    } else if (request.method === 'DELETE') {
      rows = (await tx.query(`delete from public.${table}${whereClause(url.searchParams, values)} returning *`, values)).rows;
    }
  });
  if (request.method === 'GET') return { status: 200, body: single ? rows[0] ?? null : rows };
  if (returning) return { status: request.method === 'POST' ? 201 : 200, body: single ? rows[0] ?? null : rows };
  return { status: request.method === 'POST' ? 201 : 204, body: null };
}

export async function startDevSupabase({ port = DEV_PORT, db: existing, quiet = true } = {}) {
  const db = existing || (await createDb());
  const calls = [];
  const server = http.createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', async () => {
      const url = new URL(request.url, DEV_URL);
      const send = (status, body) => {
        response.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' });
        response.end(body === null || body === undefined ? (status === 204 ? '' : 'null') : JSON.stringify(body));
      };
      if (request.method === 'OPTIONS') return send(204, null);
      try {
        const auth = claimsFrom(request);
        const body = raw ? JSON.parse(raw) : {};
        calls.push({ method: request.method, path: url.pathname, role: auth.role });
        if (!quiet) console.log(request.method, url.pathname, auth.role);

        if (url.pathname === '/auth/v1/user') {
          if (auth.role !== 'authenticated') return send(401, { code: 401, error_code: 'no_authorization', msg: 'Not signed in' });
          const user = (await db.query('select id, email, created_at from auth.users where id = $1', [auth.claims.sub])).rows[0];
          if (!user) return send(401, { code: 401, error_code: 'user_not_found', msg: 'User not found' });
          return send(200, { id: user.id, aud: 'authenticated', role: 'authenticated', email: user.email, created_at: user.created_at, app_metadata: {}, user_metadata: {} });
        }
        if (url.pathname.startsWith('/auth/v1/')) return send(200, {});

        if (url.pathname.startsWith('/rest/v1/rpc/')) {
          const name = url.pathname.replace('/rest/v1/rpc/', '');
          const args = request.method === 'GET' ? Object.fromEntries(url.searchParams) : body;
          return send(200, await callFunction(db, auth, name, args || {}));
        }
        if (url.pathname.startsWith('/rest/v1/')) {
          const result = await tableRequest(db, auth, request, url, body);
          return send(result.status, result.body);
        }
        return send(404, { message: 'not found' });
      } catch (error) {
        const { status, body } = pgError(error);
        if (!quiet) console.log('  ->', status, body.message);
        return send(status, body);
      }
    });
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return { db, server, calls, url: `http://localhost:${port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

// ------------------------------------------------------------
// Demo data: one customer with two locations (one Pro, one Basic), a second customer, an admin.
// ------------------------------------------------------------
function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export async function seedDemo(db) {
  const asAdmin = (admin, fn) => runAs(db, { role: 'authenticated', claims: { sub: admin.id, email: admin.email, role: 'authenticated' } }, fn);
  const admin = await createUser(db, 'admin@reviewlah.my');
  await makeAdmin(db, admin);
  const owner = await createUser(db, 'aisha@kopicorner.my');
  const other = await createUser(db, 'ben@salonseri.my');
  const newcomer = await createUser(db, 'new@example.com');

  const bundle = (tx, args) => tx.query(
    `select public.admin_create_bundle(p_company_name => $1, p_owner_email => $2, p_contact_name => $3, p_phone => $4,
       p_business_name => $5, p_address => $6, p_review_url => $7, p_plate_count => $8, p_plate_label => $9, p_pro => $10) as r`, args).then((r) => r.rows[0].r);

  const bangsar = await asAdmin(admin, (tx) => bundle(tx, ['Kopi Corner Sdn Bhd', owner.email, 'Aisha Rahman', '+60 12-345 6789',
    'Kopi Corner Bangsar', 'Jalan Telawi 3, Bangsar', 'https://search.google.com/local/writereview?placeid=ChIJDEMO0001', 3, null, true]));
  const ttdi = await asAdmin(admin, (tx) => bundle(tx, ['Kopi Corner Sdn Bhd', owner.email, null, null,
    'Kopi Corner TTDI', 'Jalan Tun Mohd Fuad, TTDI', 'https://g.page/r/DEMO-TTDI/review', 1, 'Counter', false]));
  const salon = await asAdmin(admin, (tx) => bundle(tx, ['Salon Seri', other.email, 'Ben Tan', '+60 16-222 3344',
    'Salon Seri Mont Kiara', 'Mont Kiara', 'https://maps.app.goo.gl/DemoSalon1', 1, null, false]));
  const labels = ['Counter', 'Table 4', 'Terrace'];
  for (let i = 0; i < bangsar.plates.length; i += 1) {
    await db.query('update public.plates set label = $1 where id = $2', [labels[i], bangsar.plates[i].id]);
  }

  // Scans over the last 150 days: busier on weekends and around lunch and dinner, mostly NFC.
  const random = seededRandom(20261116);
  const hourWeights = [0, 0, 0, 0, 0, 0, 0, 2, 5, 6, 5, 6, 12, 14, 8, 5, 5, 7, 11, 14, 10, 5, 2, 0];
  const pickHour = () => {
    let r = random() * hourWeights.reduce((a, b) => a + b, 0);
    for (let h = 0; h < 24; h += 1) { r -= hourWeights[h]; if (r <= 0) return h; }
    return 12;
  };
  const rows = [];
  const now = Date.now();
  const plates = [
    { id: bangsar.plates[0].id, weight: 1 }, { id: bangsar.plates[1].id, weight: 0.45 }, { id: bangsar.plates[2].id, weight: 0.25 },
    { id: ttdi.plates[0].id, weight: 0.5 }, { id: salon.plates[0].id, weight: 0.3 },
  ];
  for (let day = 150; day >= 0; day -= 1) {
    const date = new Date(now - day * 86400000);
    const weekday = new Date(date.getTime() + 8 * 3600000).getUTCDay();
    const growth = 0.55 + (150 - day) / 250;
    const base = (weekday === 0 || weekday === 6 ? 15 : weekday === 5 ? 11 : 7) * growth;
    for (const plate of plates) {
      const count = Math.round(base * plate.weight * (0.6 + random() * 0.8));
      for (let i = 0; i < count; i += 1) {
        const local = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), pickHour() - 8, Math.floor(random() * 60), Math.floor(random() * 60)));
        if (local.getTime() > now) continue;
        const r = random();
        rows.push([plate.id, r < 0.62 ? 'nfc' : r < 0.97 ? 'qr' : 'other', local.toISOString()]);
      }
    }
  }
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const values = chunk.map((_, j) => `($${j * 3 + 1}, $${j * 3 + 2}, $${j * 3 + 3})`).join(', ');
    await db.query(`insert into public.scans (plate_id, source, created_at) values ${values}`, chunk.flat());
  }
  await db.query(`update public.plates p set total_scans = s.n, last_scan_at = s.last_at
    from (select plate_id, count(*) as n, max(created_at) as last_at from public.scans group by plate_id) s where s.plate_id = p.id`);

  await asAdmin(admin, (tx) => tx.query("select public.save_link_page($1, $2, $3::jsonb, true)", [bangsar.business_id, 'Thanks for visiting Kopi Corner', JSON.stringify([
    { kind: 'menu', label: 'View our menu', url: 'https://kopicorner.my/menu' },
    { kind: 'whatsapp', label: 'Chat on WhatsApp', url: 'https://wa.me/60123456789' },
    { kind: 'booking', label: 'Book a table', url: 'https://kopicorner.my/book' },
    { kind: 'instagram', label: 'Follow us on Instagram', url: 'https://www.instagram.com/kopicorner' },
  ])]));
  await runAs(db, { role: 'authenticated', claims: { sub: other.id, email: other.email, role: 'authenticated' } },
    (tx) => tx.query("select public.create_support_request('Plate support', 'My plate opens the page on Android but not on my iPhone 8.')"));

  // Google Business Profile demo data (only visible when GBP_ENABLED=true).
  const service = (text, params) => runAs(db, { role: 'service_role', claims: { role: 'service_role' } }, (tx) => tx.query(text, params));
  await service('select public.google_save_connection($1, $2, $3, $4, $5)', [bangsar.company_id, owner.id, 'Aisha Rahman', 'v1.demo.demo.demo', 'https://www.googleapis.com/auth/business.manage']);
  await service('select public.google_link_location($1, $2, $3, $4, $5, $6)', [bangsar.business_id, 'accounts/100', 'locations/200', 'Kopi Corner Bangsar', 'Jalan Telawi 3, Kuala Lumpur', 'ChIJdemo']);
  const ago = (d) => new Date(Date.now() - d * 86400000).toISOString();
  const demoReview = (id, name, rating, comment, days, reply = null) => ({
    review_id: id, resource_name: `accounts/100/locations/200/reviews/${id}`, reviewer_name: name, rating, comment,
    create_time: ago(days), update_time: ago(days), reply_comment: reply, reply_update_time: reply ? ago(days - 0.5) : null,
  });
  await service('select public.google_upsert_reviews($1, $2::jsonb, true, 4.4, 6)', [bangsar.business_id, JSON.stringify([
    demoReview('g1', 'Mei Ling Tan', 5, 'Best kopi in Bangsar, and the kaya toast is perfect.', 1),
    demoReview('g2', 'Farid Hakim', 2, 'Waited 40 minutes for two drinks on Saturday.', 2),
    demoReview('g3', 'Priya N.', 4, null, 6),
    demoReview('g4', 'Daniel Wong', 5, 'Friendly staff, will come back.', 12, 'Thank you Daniel, see you soon!'),
    demoReview('g5', 'Siti Aminah', 5, 'Sedap! Suasana pun selesa.', 20, 'Terima kasih Siti!'),
    demoReview('g6', 'Anonymous', 3, 'Good coffee but parking is difficult.', 35),
  ])]);
  await runAs(db, { role: 'authenticated', claims: { sub: owner.id, email: owner.email, role: 'authenticated' } },
    (tx) => tx.query("select public.save_reply_draft((select id from public.google_reviews where review_id = 'g2'), 'We are sorry about the wait on Saturday. Please contact us so we can put it right.', 'en', 'ai', 'claude-haiku-5-5')"));

  return { admin, owner, other, newcomer, bangsar, ttdi, salon };
}

// Run directly: start the API with demo data and print how to log in.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { db, url } = await startDevSupabase({ quiet: false });
  const demo = await seedDemo(db);
  console.log(`\nLocal Supabase stand-in ready on ${url}`);
  console.log('Start the app with:');
  console.log(`  NEXT_PUBLIC_SUPABASE_URL=${url} NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${ANON_KEY} SUPABASE_SECRET_KEY=${SERVICE_KEY} npm run dev\n`);
  for (const [name, user] of Object.entries({ owner: demo.owner, admin: demo.admin, 'second customer': demo.other })) {
    const cookie = devSessionCookie(user);
    console.log(`To browse as the ${name} (${user.email}), set this cookie on localhost:3000:\n  ${cookie.name}=${cookie.value}\n`);
  }
}
