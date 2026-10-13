// The vault: encrypts every application and stores it so nothing is ever lost or quietly changed.
//
//   encryption   AES-256-GCM: the data is unreadable without the key, and any change to it is detected
//   no loss      append-only log: records are only ever added, never rewritten; every write is fsync'ed
//                to disk and copied to a second file (backup) before we answer "OK"
//   no tampering each record carries the hash of the one before it (a hash chain), like a ledger
//   duplicates   emails are compared by HMAC fingerprint, so we never need to decrypt to check them
//
// Built-in Node modules only: no third-party packages, nothing to be poisoned upstream.

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// DATA_DIR lets a host point us at its persistent disk (e.g. /var/data). Default: ./data, outside the web folder, never served.
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(__dirname, '..', 'data');
const LOG = path.join(DATA_DIR, 'signups.jsonl');
const BACKUP = path.join(DATA_DIR, 'backup', 'signups.jsonl');
// The key lives in a different folder from the data: a copy of data/ alone is useless to a thief.
const KEY_DIR = path.resolve(__dirname, '..', 'keys');
const KEY_FILE = path.join(KEY_DIR, 'secret.key');
const GENESIS = '0'.repeat(64);

// ---------- key ----------
// SIGNUP_KEY (base64, 32 bytes) from the environment wins; otherwise a key file is created once.
// LOSE THE KEY = LOSE THE DATA. Keep a copy somewhere other than this server.
function loadMasterKey() {
  if (process.env.SIGNUP_KEY) {
    const key = Buffer.from(process.env.SIGNUP_KEY, 'base64');
    if (key.length !== 32) throw new Error('SIGNUP_KEY must be 32 bytes, base64-encoded');
    return key;
  }
  // On a host the filesystem outside the disk is wiped on every deploy: a key file created there would
  // vanish and the stored applications could never be decrypted again. So in production the key must be given.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SIGNUP_KEY is required in production (a key file would be lost on the next deploy)');
  }
  fs.mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(KEY_FILE)) {
    fs.writeFileSync(KEY_FILE, crypto.randomBytes(32).toString('base64'), { mode: 0o600, flag: 'wx' });
    console.warn(`[vault] new key created at ${KEY_FILE} — back it up somewhere safe`);
  }
  const key = Buffer.from(fs.readFileSync(KEY_FILE, 'utf8').trim(), 'base64');
  if (key.length !== 32) throw new Error('secret.key is damaged');
  return key;
}

// One master key -> two independent keys, so the fingerprint key can't be used to decrypt.
const master = loadMasterKey();
const encKey = Buffer.from(crypto.hkdfSync('sha256', master, Buffer.alloc(0), 'strata/encrypt', 32));
const macKey = Buffer.from(crypto.hkdfSync('sha256', master, Buffer.alloc(0), 'strata/fingerprint', 32));

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const fingerprint = text => crypto.createHmac('sha256', macKey).update(text).digest('hex');
// Short public reference for an application, e.g. "ST-7K2M-9QXD". Derived from the id, so a retry gets the same one.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const reference = id => {
  const h = crypto.createHmac('sha256', macKey).update('ref:' + id).digest();
  const c = [...h.subarray(0, 8)].map(b => ALPHABET[b % 32]).join('');
  return `ST-${c.slice(0, 4)}-${c.slice(4)}`;
};

function encrypt(obj, id) {
  const iv = crypto.randomBytes(12);                              // never reuse an IV with the same key
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
  cipher.setAAD(Buffer.from(id));                                 // ciphertext is bound to its record id
  const ct = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ct: ct.toString('base64') };
}

function decrypt(box, id) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', encKey, Buffer.from(box.iv, 'base64'));
  decipher.setAAD(Buffer.from(id));
  decipher.setAuthTag(Buffer.from(box.tag, 'base64'));            // throws if a single bit was changed
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(box.ct, 'base64')), decipher.final()]).toString('utf8'));
}

// ---------- reading + checking the log ----------
function readLog(file = LOG) {
  if (!fs.existsSync(file)) return { records: [], lastHash: GENESIS, problems: [] };
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const problems = [];
  // a line without a final newline was cut off by a crash mid-write: it was never confirmed, skip it
  if (lines[lines.length - 1] !== '') problems.push('last line incomplete (crash during write) — ignored');
  lines.pop();

  const records = [];
  let prev = GENESIS;
  lines.forEach((line, i) => {
    let rec;
    try { rec = JSON.parse(line); } catch { problems.push(`line ${i + 1}: not valid JSON`); return; }
    if (rec.prev !== prev) problems.push(`line ${i + 1}: hash chain broken — file was edited or a line removed`);
    prev = sha256(line);
    records.push(rec);
  });
  return { records, lastHash: prev, problems };
}

// ---------- writing ----------
function appendDurably(file, line) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const fd = fs.openSync(file, 'a', 0o600);
  try {
    fs.writeSync(fd, line);
    fs.fsyncSync(fd);                                             // on disk, not just in the OS cache
  } finally {
    fs.closeSync(fd);
  }
}

// A crash mid-write leaves half a line at the end. Cut it off, or the next record would be glued to it.
function repairTail(file) {
  if (!fs.existsSync(file)) return;
  const buf = fs.readFileSync(file);
  if (buf.length === 0 || buf[buf.length - 1] === 0x0a) return;
  const keep = buf.lastIndexOf(0x0a) + 1;
  fs.copyFileSync(file, `${file}.crash-${Date.now()}`);            // keep the evidence, never just delete
  fs.truncateSync(file, keep);
  console.warn(`[vault] removed an unfinished line from ${path.basename(file)}`);
}

// Load state once at start-up. If the main log is missing or damaged but the backup is fine, restore it.
repairTail(LOG);
repairTail(BACKUP);
let state = readLog(LOG);
const backupState = readLog(BACKUP);
if (backupState.records.length > state.records.length && backupState.problems.length === 0) {
  console.warn('[vault] main log behind backup — restoring from backup');
  fs.copyFileSync(BACKUP, LOG);
  state = readLog(LOG);
}
state.problems.forEach(p => console.warn(`[vault] ${p}`));

const ids = new Set(state.records.map(r => r.id));
const seen = new Map(state.records.map(r => [r.fp, r.id]));   // fingerprint -> first application id
let lastHash = state.lastHash;

// Writes are queued so two requests at once can't interleave lines or break the chain.
let queue = Promise.resolve();

// dedupeKey: what makes two applications "the same" (here: email + session). Returns { result, ref }.
function save(id, data, dedupeKey) {
  const job = queue.then(() => {
    if (ids.has(id)) return { result: 'repeat', ref: reference(id) };            // same request retried
    const fp = fingerprint(dedupeKey);
    if (seen.has(fp)) return { result: 'duplicate', ref: reference(seen.get(fp)) }; // already applied

    const rec = { v: 1, id, at: new Date().toISOString(), fp, prev: lastHash, box: encrypt(data, id) };
    const line = JSON.stringify(rec);
    appendDurably(LOG, line + '\n');
    lastHash = sha256(line);                                      // the main log has it: keep memory in step
    ids.add(id);
    seen.set(fp, id);

    appendDurably(BACKUP, line + '\n');                           // second copy before we say "saved"
    return { result: 'saved', ref: reference(id) };
  });
  queue = job.catch(() => {});                                    // one failed write must not block the next
  return job;
}

module.exports = { save, readLog, decrypt, reference, LOG, BACKUP, count: () => ids.size };
