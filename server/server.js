// STRATA server: serves the site and receives applications.
//   npm start          http://localhost:8081   (local testing; traffic never leaves your machine)
//   npm run start:https https://localhost:8443  (encrypted in transit; http://…:8081 redirects there)
// Built-in Node modules only: no third-party packages.

'use strict';

const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const dns = require('node:dns').promises;
const vault = require('./vault');

const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'site');                               // the only folder visitors can read
const HTTP_PORT = Number(process.env.PORT) || 8081;
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 8443;
const HOST = process.env.HOST || '127.0.0.1';
const USE_TLS = process.env.HTTPS === '1';
// On a host such as Render the platform handles HTTPS and forwards plain HTTP to us (TRUST_PROXY=1).
// Only turn this on behind such a proxy: otherwise visitors could fake their address.
const BEHIND_PROXY = process.env.TRUST_PROXY === '1';
const MAX_BODY = 4 * 1024;

// The visitor's address, for the rate limit. Behind a proxy every request arrives from the proxy itself,
// so we read X-Forwarded-For and take the LAST entry: that one was added by the platform, the earlier ones the client can fake.
const clientIp = req => (BEHIND_PROXY && String(req.headers['x-forwarded-for'] || '').split(',').pop().trim()) || req.socket.remoteAddress;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
};

const HEADERS = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; object-src 'none'; frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  ...(USE_TLS || BEHIND_PROXY ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}),
};

// ---------- validation (same rules as app.js — the browser's checks can be skipped) ----------
const SESSIONS = ['2027-02', '2027-05', '2027-09'];
const ROLES = ['CEO', 'CFO', 'COO', 'CTO / CIO', 'Chief Data / AI Officer', 'Other C-level', 'Board member', 'Other'];
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[a-z]{2,}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;   // allow \n in notes only

const MARKUP = /[<>]/;                                              // no real name or company contains < or >

const str = (v, min, max, allowNewline = false) =>
  typeof v === 'string' && v.trim().length >= min && v.trim().length <= max &&
  !CONTROL.test(v) && (allowNewline || !/[\r\n]/.test(v));

function validate(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { fields: ['session'] };
  const fields = [];
  if (!SESSIONS.includes(b.session)) fields.push('session');
  if (!str(b.firstName, 1, 60) || MARKUP.test(b.firstName)) fields.push('firstName');
  if (!str(b.lastName, 1, 60) || MARKUP.test(b.lastName)) fields.push('lastName');
  if (!str(b.email, 6, 120) || !EMAIL.test(b.email.trim())) fields.push('email');
  if (!str(b.company, 2, 100) || MARKUP.test(b.company)) fields.push('company');
  if (!ROLES.includes(b.role)) fields.push('role');
  if (!Number.isInteger(b.seats) || b.seats < 1 || b.seats > 10) fields.push('seats');
  if (b.notes !== undefined && b.notes !== '' && !str(b.notes, 0, 500, true)) fields.push('notes');
  if (b.consent !== true) fields.push('consent');
  if (typeof b.id !== 'string' || !UUID.test(b.id)) fields.push('session');   // malformed client: generic
  if (fields.length) return { fields };

  // keep ONLY known fields — anything extra is dropped here
  return {
    id: b.id,
    data: {
      session: b.session, firstName: b.firstName.trim(), lastName: b.lastName.trim(),
      email: b.email.trim().toLowerCase(), company: b.company.trim(), role: b.role,
      seats: b.seats, notes: (b.notes || '').trim(), consentAt: new Date().toISOString(),
    },
  };
}

// Does the email's domain exist and accept mail? (MX record, or an A record as the fallback mail host.)
// This can't prove the mailbox exists — only a confirmation email can — but it catches typos like "@gmial.co".
async function domainAcceptsMail(email) {
  const domain = email.split('@')[1];
  const timeout = new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 3000));
  try {
    const mx = await Promise.race([dns.resolveMx(domain), timeout]);
    if (mx.length && !(mx.length === 1 && mx[0].exchange === '')) return 'yes';    // "" = null MX: no mail
    return 'no';
  } catch (err) {
    if (err.code === 'ENOTFOUND' || err.code === 'ENODATA') {
      try { await Promise.race([dns.resolve4(domain), timeout]); return 'yes'; } catch { return 'no'; }
    }
    return 'unknown';   // DNS itself is down: accept, don't lose the application, mark it unchecked
  }
}

// ---------- rate limit: 10 requests per IP per 10 minutes (one office often shares one IP) ----------
const hits = new Map();
const limited = ip => {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < 600000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 10;
};
setInterval(() => { const now = Date.now(); for (const [ip, t] of hits) if (now - t.at(-1) > 600000) hits.delete(ip); }, 60000).unref();

// ---------- helpers ----------
const log = msg => console.log(`${new Date().toISOString()} ${msg}`);       // never names, emails or companies
function json(res, status, body, extra = {}) {
  res.writeHead(status, { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(JSON.stringify(body));
}
function text(res, status, body) {
  res.writeHead(status, { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(body);
}

// ---------- POST /api/apply ----------
function apply(req, res) {
  let sameSite = false;
  try { sameSite = new URL(req.headers.origin).host === req.headers.host; } catch {}
  if (!sameSite) return json(res, 403, { error: 'forbidden' });                       // CSRF
  if (!String(req.headers['content-type']).startsWith('application/json')) return json(res, 415, { error: 'json only' });

  const chunks = [];
  let size = 0;
  req.on('data', c => {
    size += c.length;
    if (size > MAX_BODY) { json(res, 413, { error: 'too large' }); req.destroy(); }
    else chunks.push(c);
  });
  req.on('end', async () => {
    if (res.writableEnded) return;
    if (limited(clientIp(req))) { log('rate-limited'); return json(res, 429, { error: 'slow down' }, { 'Retry-After': '600' }); }

    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return json(res, 400, { error: 'bad json' }); }
    if (body && body.website) return json(res, 422, { fields: ['session'] });          // honeypot

    const v = validate(body);
    if (v.fields) return json(res, 422, { fields: [...new Set(v.fields)] });

    const mail = await domainAcceptsMail(v.data.email);
    if (mail === 'no') { log('rejected: email domain'); return json(res, 422, { fields: ['emailDomain'] }); }
    v.data.emailChecked = mail === 'yes';

    try {
      const { result, ref } = await vault.save(v.id, v.data, `${v.data.email}|${v.data.session}`);
      log(`application ${result} (total ${vault.count()})`);
      json(res, 200, { ok: true, ref });          // only a reference goes back — never the data itself
    } catch (err) {
      log(`SAVE FAILED ${err.code || err.message}`);
      json(res, 503, { error: 'try again' }, { 'Retry-After': '5' });                   // browser retries
    }
  });
}

// ---------- static files ----------
function serve(req, res) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { return text(res, 400, 'Bad request'); }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = path.resolve(WEB, '.' + pathname);
  const ext = path.extname(file).toLowerCase();
  if (!file.startsWith(WEB + path.sep) || pathname.split('/').some(p => p.startsWith('.')) || !TYPES[ext]) return text(res, 404, 'Not found');
  fs.readFile(file, (err, buf) => {
    if (err) return text(res, 404, 'Not found');
    res.writeHead(200, { ...HEADERS, 'Content-Type': TYPES[ext], 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
}

function handler(req, res) {
  if (req.url === '/api/apply') return req.method === 'POST' ? apply(req, res) : json(res, 405, { error: 'POST only' }, { Allow: 'POST' });
  if (req.method !== 'GET' && req.method !== 'HEAD') return text(res, 405, 'Method not allowed');
  serve(req, res);
}

// ---------- start ----------
const servers = [];
if (USE_TLS) {
  const certDir = path.join(ROOT, 'certs');
  const tls = { key: fs.readFileSync(path.join(certDir, 'key.pem')), cert: fs.readFileSync(path.join(certDir, 'cert.pem')), minVersion: 'TLSv1.2' };
  servers.push(https.createServer(tls, handler).listen(HTTPS_PORT, HOST, () => log(`STRATA on https://localhost:${HTTPS_PORT}`)));
  // plain HTTP only redirects — data is never accepted unencrypted
  servers.push(http.createServer((req, res) => {
    const host = String(req.headers.host || 'localhost').replace(/:\d+$/, '');
    res.writeHead(308, { Location: `https://${host}:${HTTPS_PORT}${req.url}` });
    res.end();
  }).listen(HTTP_PORT, HOST));
} else {
  servers.push(http.createServer(handler).listen(HTTP_PORT, HOST, () =>
    log(BEHIND_PROXY
      ? `STRATA on port ${HTTP_PORT} behind the host's HTTPS proxy`
      : `STRATA on http://localhost:${HTTP_PORT} (local only — use npm run start:https or a HTTPS host for real traffic)`)));
}
servers.forEach(s => { s.requestTimeout = 15000; s.headersTimeout = 5000; });
log(`${vault.count()} applications stored`);

const stop = () => { log('shutting down'); servers.forEach(s => s.close()); setTimeout(() => process.exit(0), 2000).unref(); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
