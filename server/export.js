// Owner tools — run on the server, never reachable from the web.
//   node server/export.js check          verify the log and backup: hash chain + every record decrypts
//   node server/export.js csv > out.csv  decrypt everything into a spreadsheet for the team

'use strict';

const vault = require('./vault');

const mode = process.argv[2] || 'check';

function verify(file, label) {
  const { records, problems } = vault.readLog(file);
  let bad = 0;
  for (const r of records) {
    try { vault.decrypt(r.box, r.id); } catch { bad++; problems.push(`record ${r.id}: failed to decrypt — changed or wrong key`); }
  }
  console.error(`${label}: ${records.length} records, ${bad} unreadable, ${problems.length ? 'PROBLEMS' : 'chain OK'}`);
  problems.forEach(p => console.error(`  - ${p}`));
  return { records, ok: problems.length === 0 };
}

// Excel runs cells that start with = + - @ as formulas: prefix them so a sign-up can't become a formula
const cell = v => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
};

if (mode === 'check') {
  const main = verify(vault.LOG, 'main log');
  const backup = verify(vault.BACKUP, 'backup  ');
  process.exitCode = main.ok && backup.ok ? 0 : 1;
} else if (mode === 'csv') {
  const { records } = verify(vault.LOG, 'main log');
  console.log(['reference', 'received', 'session', 'first name', 'last name', 'email', 'email domain checked', 'company', 'role', 'seats', 'total EUR', 'notes', 'consent given'].map(cell).join(','));
  for (const r of records) {
    try {
      const d = vault.decrypt(r.box, r.id);
      console.log([vault.reference(r.id), r.at, d.session, d.firstName, d.lastName, d.email, d.emailChecked, d.company, d.role, d.seats, d.seats * 5000, d.notes, d.consentAt].map(cell).join(','));
    } catch { /* already reported by verify */ }
  }
} else {
  console.error('usage: node server/export.js [check|csv]');
  process.exitCode = 2;
}
