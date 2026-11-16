// Import / export helpers for the Excel / CSV sheet format:
//   Folder | Name | Value | Sensitive
// Folder is a path such as "Company / Bank". Sensitive is yes/no (optional).

export function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const str = (v) => (v === null || v === undefined ? '' : String(v)).trim();
const YES = new Set(['yes', 'y', 'true', '1']);

export function splitPath(p) {
  return str(p).split(/[\/>\\]/).map((s) => s.trim()).filter(Boolean);
}

// rows: array of arrays. Returns { records, skipped }.
export function rowsToRecords(rows) {
  const records = [];
  let skipped = 0;
  rows.forEach((r, i) => {
    const folder = str(r[0]), label = str(r[1]), sens = str(r[3]).toLowerCase();
    const value = r[2] === null || r[2] === undefined ? '' : String(r[2]);
    if (i === 0 && folder.toLowerCase() === 'folder' && label.toLowerCase() === 'name') return;
    if (!folder && !label && !value.trim()) return;
    if (!label || !value.trim()) { skipped++; return; }
    records.push({ path: splitPath(folder), label, value, sensitive: YES.has(sens) });
  });
  return { records, skipped };
}

const q = (s) => (/[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);

export function toCsv(records) {
  const lines = [['Folder', 'Name', 'Value', 'Sensitive']];
  for (const r of records) lines.push([r.path.join(' / '), r.label, r.value, r.sensitive ? 'yes' : 'no']);
  return '﻿' + lines.map((l) => l.map(q).join(',')).join('\r\n') + '\r\n';
}

export const TEMPLATE = [
  { path: ['Company'], label: 'Company name', value: 'Your Company Pvt Ltd', sensitive: false },
  { path: ['Company'], label: 'Address', value: '12 Example Road, City - 400001', sensitive: false },
  { path: ['Company', 'Bank'], label: 'Account number', value: '000111222333', sensitive: true },
];
