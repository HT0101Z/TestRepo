import { STYLES, applyStyle } from './textcase.js';
import { createVault, unlock, saveData, setPassword, isVault } from './vault.js';
import { parseCsv, rowsToRecords, toCsv, TEMPLATE } from './io.js';
import { platform } from './platform.js';

const root = document.getElementById('app');
const toastEl = document.getElementById('toast');

let file = null;      // encrypted vault as stored on disk
let session = null;   // { role, raw, dk } while unlocked
let data = null;      // decrypted { folders, items, settings }
const ui = { view: 'board', folderId: null, search: '', style: 'normal', mini: false };
let contentEl = null;
let clipTimer = null;
let lastActive = Date.now();

const DEFAULT_SETTINGS = { autoLockMin: 5, clipClearSec: 30, clipClearScope: 'sensitive' };
const isAdmin = () => session && session.role === 'admin';
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ---------- small DOM helpers ----------

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

// Modal form. Resolves to an object of values, or null when cancelled.
function form({ title, text, fields = [], ok = 'Save', danger = false, validate }) {
  return new Promise((resolve) => {
    const inputs = {};
    const err = h('div', { class: 'error' });
    const body = fields.map((f) => {
      let input;
      if (f.type === 'textarea') input = h('textarea', { rows: 4, value: f.value || '' });
      else if (f.type === 'select') {
        input = h('select', {}, f.options.map((o) => h('option', { value: o.value }, o.label)));
        input.value = f.value;
      } else if (f.type === 'checkbox') input = h('input', { type: 'checkbox', checked: f.value });
      else input = h('input', { type: f.type || 'text', value: f.value ?? '', autocomplete: f.type === 'password' ? 'new-password' : 'off' });
      inputs[f.name] = input;
      return f.type === 'checkbox'
        ? h('label', { class: 'check' }, input, f.label)
        : h('div', {}, h('label', {}, f.label, input));
    });
    const dlg = h('dialog', {},
      h('form', { method: 'dialog', onsubmit: (e) => {
        e.preventDefault();
        const vals = {};
        for (const f of fields) vals[f.name] = f.type === 'checkbox' ? inputs[f.name].checked : inputs[f.name].value;
        const problem = validate && validate(vals);
        if (problem) { err.textContent = problem; return; }
        dlg.close(); dlg.remove(); resolve(vals);
      } },
        h('h3', {}, title),
        text && h('div', { class: 'muted' }, text),
        body, err,
        h('div', { class: 'btns' },
          h('button', { type: 'button', onclick: () => { dlg.close(); dlg.remove(); resolve(null); } }, 'Cancel'),
          h('button', { type: 'submit', class: danger ? 'primary danger' : 'primary' }, ok))));
    dlg.addEventListener('cancel', () => { dlg.remove(); resolve(null); });
    document.body.append(dlg);
    dlg.showModal();
    const first = fields[0] && inputs[fields[0].name];
    if (first) { first.focus(); if (first.select && fields[0].type !== 'select') first.select(); }
  });
}

const confirmBox = (title, text, ok = 'Yes', danger = false) => form({ title, text, ok, danger }).then(Boolean);

function pickFile(accept) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, hidden: true });
    input.addEventListener('change', () => { resolve(input.files[0] || null); input.remove(); });
    input.addEventListener('cancel', () => { resolve(null); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

// ---------- data helpers ----------

const kids = (parentId) => data.folders.filter((f) => f.parentId === parentId);
const folderById = (id) => data.folders.find((f) => f.id === id);

function pathOf(folderId) {
  const parts = [];
  for (let f = folderById(folderId); f; f = folderById(f.parentId)) parts.unshift(f.name);
  return parts;
}

function flatFolders(parentId = null, depth = 0, out = []) {
  for (const f of kids(parentId)) { out.push({ f, depth }); flatFolders(f.id, depth + 1, out); }
  return out;
}

function descendants(id, out = new Set([id])) {
  for (const f of kids(id)) { out.add(f.id); descendants(f.id, out); }
  return out;
}

function ensurePath(parts) {
  let parentId = null;
  for (const name of parts) {
    let f = data.folders.find((x) => x.parentId === parentId && x.name.toLowerCase() === name.toLowerCase());
    if (!f) { f = { id: uid(), name, parentId }; data.folders.push(f); }
    parentId = f.id;
  }
  return parentId;
}

const folderOptions = (exclude = new Set()) => [
  { value: '', label: 'Home (top level)' },
  ...flatFolders().filter(({ f }) => !exclude.has(f.id))
    .map(({ f, depth }) => ({ value: f.id, label: '  '.repeat(depth + 1) + f.name })),
];

async function commit() {
  file = await saveData(file, session, data);
  await platform.saveVault(file);
}

// ---------- lock / unlock ----------

function lock(msg) {
  session = null; data = null; // a pending clipboard-clear timer keeps running on purpose
  document.querySelectorAll('dialog').forEach((d) => d.remove());
  ui.view = 'board'; ui.search = ''; ui.folderId = null;
  render();
  if (msg) toast(msg);
}

function renderSetup() {
  const a1 = h('input', { type: 'password', autocomplete: 'new-password' });
  const a2 = h('input', { type: 'password', autocomplete: 'new-password' });
  const o1 = h('input', { type: 'password', autocomplete: 'new-password' });
  const o2 = h('input', { type: 'password', autocomplete: 'new-password' });
  const err = h('div', { class: 'error' });
  const btn = h('button', { class: 'primary', type: 'submit' }, 'Create and open');
  root.replaceChildren(h('form', { class: 'auth', onsubmit: async (e) => {
    e.preventDefault();
    const problem = a1.value.length < 6 || o1.value.length < 6 ? 'Passwords need at least 6 characters.'
      : a1.value !== a2.value ? 'Admin passwords do not match.'
      : o1.value !== o2.value ? 'Operator passwords do not match.'
      : a1.value === o1.value ? 'Admin and Operator passwords must be different.' : '';
    if (problem) { err.textContent = problem; return; }
    btn.disabled = true; btn.textContent = 'Setting up…';
    const start = { folders: [], items: [], settings: { ...DEFAULT_SETTINGS } };
    const made = await createVault(a1.value, o1.value, start);
    await platform.saveVault(made.file);
    file = made.file; session = made.session; data = start;
    render();
  } },
    h('h1', {}, 'Welcome to SnipBoard'),
    h('div', { class: 'muted' }, 'First-time setup. Create the two passwords for this device.'),
    h('label', {}, 'Admin password (can add, edit and delete)', a1),
    h('label', {}, 'Repeat Admin password', a2),
    h('label', {}, 'Operator password (can only view and copy)', o1),
    h('label', {}, 'Repeat Operator password', o2),
    err, btn,
    h('div', { class: 'note' }, 'Keep the Admin password safe. Your data is encrypted with it, so if both passwords are lost the data cannot be recovered.')));
  a1.focus();
}

function renderLogin() {
  const pw = h('input', { type: 'password', autocomplete: 'current-password' });
  const err = h('div', { class: 'error' });
  const btn = h('button', { class: 'primary', type: 'submit' }, 'Unlock');
  root.replaceChildren(h('form', { class: 'auth', onsubmit: async (e) => {
    e.preventDefault();
    btn.disabled = true; btn.textContent = 'Checking…'; err.textContent = '';
    const res = await unlock(file, pw.value);
    if (!res) {
      btn.disabled = false; btn.textContent = 'Unlock';
      err.textContent = 'Wrong password.'; pw.select();
      return;
    }
    session = res.session; data = res.data;
    data.settings = { ...DEFAULT_SETTINGS, ...data.settings };
    lastActive = Date.now();
    render();
  } },
    h('h1', {}, 'SnipBoard'),
    h('div', { class: 'muted' }, 'Enter your Admin or Operator password.'),
    h('label', {}, 'Password', pw),
    err, btn));
  pw.focus();
}

// ---------- copy ----------

async function copyText(text, styleId, name, sensitive, tile) {
  const c = applyStyle(styleId, text);
  try { await platform.copy(c); } catch { toast('Could not copy. Try again.'); return; }
  const style = STYLES.find((s) => s.id === styleId);
  const { clipClearSec, clipClearScope } = data.settings;
  const willClear = clipClearSec > 0 && (clipClearScope === 'all' || sensitive);
  clearTimeout(clipTimer);
  if (willClear) clipTimer = setTimeout(() => platform.clearClipboardIf(c.text), clipClearSec * 1000);
  toast('Copied' + (name ? ': ' + name : '') + (styleId !== 'normal' ? ' (' + style.label + ')' : '')
    + (willClear ? ' · clears in ' + clipClearSec + 's' : ''));
  if (tile) { tile.classList.add('copied'); setTimeout(() => tile.classList.remove('copied'), 900); }
}

function styleMenu(item) {
  const dlg = h('dialog', { class: 'menu' },
    h('div', { class: 'muted' }, 'Copy "' + item.label + '" as'),
    STYLES.map((s) => h('button', { type: 'button', onclick: () => { dlg.close(); dlg.remove(); copyText(item.value, s.id, item.label, item.sensitive); } },
      s.label, h('small', {}, s.sample))),
    h('button', { type: 'button', class: 'muted', onclick: () => { dlg.close(); dlg.remove(); } }, 'Cancel'));
  dlg.addEventListener('cancel', () => dlg.remove());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) { dlg.close(); dlg.remove(); } });
  document.body.append(dlg);
  dlg.showModal();
}

// ---------- admin actions ----------

async function editItem(item) {
  const isNew = !item;
  const vals = await form({
    title: isNew ? 'New item' : 'Edit item',
    fields: [
      { name: 'label', label: 'Name (shown on the button)', value: item ? item.label : '' },
      { name: 'value', label: 'Text to copy', type: 'textarea', value: item ? item.value : '' },
      { name: 'folderId', label: 'Folder', type: 'select', value: (item ? item.folderId : ui.folderId) || '', options: folderOptions() },
      { name: 'sensitive', label: 'Sensitive (hide the text on screen and clear it from the clipboard)', type: 'checkbox', value: item ? item.sensitive : false },
    ],
    validate: (v) => (!v.label.trim() ? 'Please enter a name.' : !v.value.trim() ? 'Please enter the text to copy.' : ''),
  });
  if (!vals) return;
  const next = { label: vals.label.trim(), value: vals.value, folderId: vals.folderId || null, sensitive: vals.sensitive };
  if (isNew) data.items.push({ id: uid(), ...next }); else Object.assign(item, next);
  await commit(); renderContent();
}

async function renameItem(item) {
  const vals = await form({ title: 'Rename item', ok: 'Rename',
    fields: [{ name: 'label', label: 'New name', value: item.label }],
    validate: (v) => (!v.label.trim() ? 'Please enter a name.' : '') });
  if (!vals) return;
  item.label = vals.label.trim();
  await commit(); renderContent();
}

async function deleteItem(item) {
  if (!await confirmBox('Delete item?', '"' + item.label + '" will be removed permanently.', 'Delete', true)) return;
  data.items = data.items.filter((x) => x !== item);
  await commit(); renderContent();
}

async function moveItem(item, dir) {
  const same = data.items.filter((x) => x.folderId === item.folderId);
  const other = same[same.indexOf(item) + dir];
  if (!other) return;
  const a = data.items.indexOf(item), b = data.items.indexOf(other);
  [data.items[a], data.items[b]] = [data.items[b], data.items[a]];
  await commit(); renderContent();
}

async function newFolder(parentId) {
  const vals = await form({ title: parentId ? 'New subfolder in "' + folderById(parentId).name + '"' : 'New folder', ok: 'Create',
    fields: [{ name: 'name', label: 'Folder name', value: '' }],
    validate: (v) => (!v.name.trim() ? 'Please enter a name.' : '') });
  if (!vals) return;
  const f = { id: uid(), name: vals.name.trim(), parentId };
  data.folders.push(f);
  ui.folderId = f.id;
  await commit(); render();
}

async function renameFolder(f) {
  const vals = await form({ title: 'Rename folder', ok: 'Rename',
    fields: [{ name: 'name', label: 'New name', value: f.name }],
    validate: (v) => (!v.name.trim() ? 'Please enter a name.' : '') });
  if (!vals) return;
  f.name = vals.name.trim();
  await commit(); render();
}

async function moveFolder(f) {
  const vals = await form({ title: 'Move "' + f.name + '"', ok: 'Move',
    fields: [{ name: 'parentId', label: 'Move inside', type: 'select', value: f.parentId || '', options: folderOptions(descendants(f.id)) }] });
  if (!vals) return;
  f.parentId = vals.parentId || null;
  await commit(); render();
}

async function deleteFolder(f) {
  const ids = descendants(f.id);
  const n = data.items.filter((x) => ids.has(x.folderId)).length;
  const text = 'This also deletes ' + (ids.size - 1) + ' subfolder(s) and ' + n + ' item(s) inside it. This cannot be undone.';
  if (!await confirmBox('Delete folder "' + f.name + '"?', text, 'Delete everything', true)) return;
  data.folders = data.folders.filter((x) => !ids.has(x.id));
  data.items = data.items.filter((x) => !ids.has(x.folderId));
  ui.folderId = f.parentId;
  await commit(); render();
}

// ---------- board ----------

function tile(item, showPath) {
  const admin = isAdmin();
  const el = h('div', { class: 'tile' },
    h('button', { class: 'hit', title: 'Click to copy', onclick: () => copyText(item.value, ui.style, item.label, item.sensitive, el) },
      showPath && h('span', { class: 'path' }, ['Home', ...pathOf(item.folderId)].join(' / ')),
      h('span', { class: 'name' }, item.label),
      h('span', { class: 'value' }, item.sensitive ? '••••••••' : item.value)),
    h('div', { class: 'acts' },
      h('button', { class: 'ghost', onclick: () => styleMenu(item) }, 'Copy as…'),
      admin && h('button', { class: 'ghost', onclick: () => renameItem(item) }, 'Rename'),
      admin && h('button', { class: 'ghost', onclick: () => editItem(item) }, 'Edit'),
      admin && !showPath && h('button', { class: 'ghost', title: 'Move up', 'aria-label': 'Move up', onclick: () => moveItem(item, -1) }, '↑'),
      admin && !showPath && h('button', { class: 'ghost', title: 'Move down', 'aria-label': 'Move down', onclick: () => moveItem(item, 1) }, '↓'),
      admin && h('button', { class: 'ghost danger', onclick: () => deleteItem(item) }, 'Delete')));
  return el;
}

function renderBoard() {
  const admin = isAdmin();
  if (ui.folderId && !folderById(ui.folderId)) ui.folderId = null;
  const q = ui.search.trim().toLowerCase();
  if (q) {
    const hits = data.items.filter((i) => i.label.toLowerCase().includes(q)
      || (!i.sensitive && i.value.toLowerCase().includes(q))
      || pathOf(i.folderId).join(' / ').toLowerCase().includes(q));
    return [
      h('div', { class: 'folderbar' }, h('h2', {}, hits.length + ' result' + (hits.length === 1 ? '' : 's') + ' for "' + ui.search.trim() + '"')),
      hits.length ? h('div', { class: 'grid' }, hits.map((i) => tile(i, true))) : h('div', { class: 'empty' }, 'Nothing matches. Try a shorter word.'),
    ];
  }
  const f = folderById(ui.folderId);
  const items = data.items.filter((i) => i.folderId === ui.folderId);
  const subs = kids(ui.folderId);
  const sel = h('select', { 'aria-label': 'Folder', onchange: () => { ui.folderId = sel.value || null; render(); } },
    folderOptions().map((o) => h('option', { value: o.value }, o.label)));
  sel.value = ui.folderId || '';
  return [
    h('div', { class: 'foldersel' }, sel),
    h('div', { class: 'folderbar' },
      h('h2', {}, ['Home', ...pathOf(ui.folderId)].join(' / ')),
      h('span', { class: 'spacer' }),
      admin && h('button', { class: 'primary', onclick: () => editItem(null) }, '+ New item'),
      admin && h('button', { onclick: () => newFolder(ui.folderId) }, f ? '+ Subfolder' : '+ Folder'),
      admin && f && h('button', { onclick: () => renameFolder(f) }, 'Rename folder'),
      admin && f && h('button', { onclick: () => moveFolder(f) }, 'Move folder'),
      admin && f && h('button', { class: 'danger', onclick: () => deleteFolder(f) }, 'Delete folder')),
    subs.length ? h('div', { class: 'subs' }, subs.map((s) => h('button', { onclick: () => { ui.folderId = s.id; render(); } }, '📁 ' + s.name))) : null,
    items.length ? h('div', { class: 'grid' }, items.map((i) => tile(i, false)))
      : h('div', { class: 'empty' }, admin ? 'No items here yet. Use "+ New item" to add the first one.' : 'No items in this folder.'),
  ];
}

// ---------- text tools ----------

function renderTools() {
  const input = h('textarea', { rows: 6, placeholder: 'Type or paste any text here…', 'aria-label': 'Text to convert' });
  return [h('div', { class: 'panel' },
    h('h3', {}, 'Text tools'),
    h('div', { class: 'muted' }, 'Type or paste text, then press a button to copy it in that style.'),
    h('div', { class: 'row' }, input),
    h('div', { class: 'row' }, STYLES.filter((s) => s.id !== 'normal').map((s) => h('button', { title: s.sample,
      onclick: () => { if (input.value) copyText(input.value, s.id, '', false); else toast('Type some text first.'); } }, s.label))),
    h('div', { class: 'row' },
      h('button', { onclick: () => {
        const map = { upper: 1, lower: 1, sentence: 1, title: 1 };
        if (map[ui.style]) input.value = applyStyle(ui.style, input.value).text;
        else toast('Pick BIG, small, First capital or Each Word above first.');
      } }, 'Change the text in the box to the selected copy style'),
      h('button', { onclick: () => { input.value = ''; input.focus(); } }, 'Clear')))];
}

// ---------- settings (admin) ----------

async function changePassword(role) {
  const name = role === 'admin' ? 'Admin' : 'Operator';
  const vals = await form({ title: 'Change ' + name + ' password', ok: 'Change password',
    fields: [{ name: 'p1', label: 'New ' + name + ' password', type: 'password' }, { name: 'p2', label: 'Repeat it', type: 'password' }],
    validate: (v) => (v.p1.length < 6 ? 'Use at least 6 characters.' : v.p1 !== v.p2 ? 'The two passwords do not match.' : '') });
  if (!vals) return;
  const clash = await unlock(file, vals.p1);
  if (clash && clash.role !== role) { toast('That password is already used by the other role. Nothing changed.'); return; }
  file = await setPassword(file, session, role, vals.p1);
  await platform.saveVault(file);
  toast(name + ' password changed.');
}

const today = () => new Date().toISOString().slice(0, 10);
const allRecords = () => data.items.map((i) => ({ path: pathOf(i.folderId), label: i.label, value: i.value, sensitive: !!i.sensitive }));

async function importSheet() {
  const f = await pickFile('.xlsx,.csv');
  if (!f) return;
  let rows;
  try {
    if (/\.csv$/i.test(f.name)) rows = parseCsv(await f.text());
    else {
      const res = await globalThis.readXlsxFile(f);
      rows = res.length && res[0] && !Array.isArray(res[0]) && res[0].data ? res[0].data : res;
    }
  } catch { toast('Could not read that file. Use .xlsx or .csv.'); return; }
  const { records, skipped } = rowsToRecords(rows);
  if (!records.length) { toast('No rows found. Columns must be: Folder, Name, Value, Sensitive.'); return; }
  const have = new Set(allRecords().map((r) => JSON.stringify([r.path.map((p) => p.toLowerCase()), r.label, r.value])));
  const fresh = records.filter((r) => !have.has(JSON.stringify([r.path.map((p) => p.toLowerCase()), r.label, r.value])));
  const text = fresh.length + ' new item(s) will be added. ' + (records.length - fresh.length) + ' already exist and '
    + skipped + ' row(s) have no name or value, so they are skipped.';
  if (!fresh.length) { toast('Nothing new to import.'); return; }
  if (!await confirmBox('Import from ' + f.name + '?', text, 'Import')) return;
  for (const r of fresh) data.items.push({ id: uid(), folderId: ensurePath(r.path), label: r.label, value: r.value, sensitive: r.sensitive });
  await commit(); render();
  toast('Imported ' + fresh.length + ' item(s).');
}

async function restoreBackup() {
  const f = await pickFile('');
  if (!f) return;
  let obj;
  try { obj = JSON.parse(await f.text()); } catch { obj = null; }
  if (!isVault(obj)) { toast('That is not a SnipBoard backup file.'); return; }
  const text = 'Everything on this device is replaced by the backup. You will then log in with the passwords that were in use when the backup was made.';
  if (!await confirmBox('Restore backup?', text, 'Replace my data', true)) return;
  await platform.saveVault(obj);
  file = obj;
  lock('Backup restored. Please log in.');
}

function renderSettings() {
  const s = data.settings;
  const save = async () => { await commit(); toast('Saved.'); };
  const lockSel = h('select', { 'aria-label': 'Auto-lock', onchange: () => { s.autoLockMin = +lockSel.value; save(); } },
    [[1, '1 minute'], [5, '5 minutes'], [15, '15 minutes'], [30, '30 minutes'], [0, 'Never']].map(([v, l]) => h('option', { value: v }, l)));
  lockSel.value = s.autoLockMin;
  const clipSel = h('select', { 'aria-label': 'Clear clipboard after', onchange: () => { s.clipClearSec = +clipSel.value; save(); } },
    [[15, '15 seconds'], [30, '30 seconds'], [60, '1 minute'], [0, 'Never']].map(([v, l]) => h('option', { value: v }, l)));
  clipSel.value = s.clipClearSec;
  const scopeSel = h('select', { 'aria-label': 'Which items', onchange: () => { s.clipClearScope = scopeSel.value; save(); } },
    h('option', { value: 'sensitive' }, 'Sensitive items only'), h('option', { value: 'all' }, 'Everything copied'));
  scopeSel.value = s.clipClearScope;
  return [
    h('div', { class: 'panel' },
      h('h3', {}, 'Passwords'),
      h('div', { class: 'muted' }, 'Admin can change everything. Operators can only view and copy.'),
      h('div', { class: 'row' },
        h('button', { onclick: () => changePassword('admin') }, 'Change Admin password'),
        h('button', { onclick: () => changePassword('operator') }, 'Change Operator password'))),
    h('div', { class: 'panel' },
      h('h3', {}, 'Auto-lock and clipboard'),
      h('div', { class: 'row' }, 'Lock the app when nobody uses it for', lockSel),
      h('div', { class: 'row' }, 'Clear copied text from the clipboard after', clipSel, 'for', scopeSel)),
    h('div', { class: 'panel' },
      h('h3', {}, 'Backup'),
      h('div', { class: 'muted' }, 'The backup file is encrypted. It opens only with the passwords in use today.'),
      h('div', { class: 'row' },
        h('button', { onclick: async () => { if (await platform.saveFile('snipboard-backup-' + today() + '.snipbackup', JSON.stringify(file), 'application/json')) toast('Backup saved.'); } }, 'Save backup file'),
        h('button', { class: 'danger', onclick: restoreBackup }, 'Restore from backup…'))),
    h('div', { class: 'panel' },
      h('h3', {}, 'Excel / CSV'),
      h('div', { class: 'muted' }, 'Sheet columns: Folder, Name, Value, Sensitive. Folder can be a path such as "Company / Bank".'),
      h('div', { class: 'row' },
        h('button', { onclick: importSheet }, 'Import from Excel or CSV…'),
        h('button', { onclick: () => platform.saveFile('snipboard-template.csv', toCsv(TEMPLATE), 'text/csv') }, 'Download sample sheet'),
        h('button', { onclick: async () => {
          if (!await confirmBox('Export all items?', 'The CSV file is NOT encrypted. Anyone who opens it can read every item, including sensitive ones.', 'Export')) return;
          platform.saveFile('snipboard-items-' + today() + '.csv', toCsv(allRecords()), 'text/csv');
        } }, 'Export all items to CSV'))),
  ];
}

// ---------- shell ----------

function renderContent() {
  if (!contentEl) return;
  const view = ui.view === 'settings' && isAdmin() ? renderSettings() : ui.view === 'tools' ? renderTools() : renderBoard();
  contentEl.replaceChildren(...view.filter(Boolean));
}

function sideTree() {
  const node = (id, name, depth) => h('button', { class: 'node', 'aria-current': ui.folderId === id && !ui.search ? 'true' : null,
    'data-depth': depth, onclick: () => { ui.folderId = id; ui.search = ''; ui.view = 'board'; render(); } }, '   '.repeat(depth) + (depth ? '📁 ' : '🏠 ') + name);
  return [node(null, 'Home', 0), ...flatFolders().map(({ f, depth }) => node(f.id, f.name, depth + 1))];
}

function renderMain() {
  const admin = isAdmin();
  const search = h('input', { class: 'search', type: 'search', placeholder: 'Search all items…', 'aria-label': 'Search all items', value: ui.search,
    oninput: () => { ui.search = search.value; ui.view = 'board'; renderContent(); } });
  const tab = (id, label) => h('button', { 'aria-pressed': String(ui.view === id), onclick: () => { ui.view = id; ui.search = ''; render(); } }, label);
  contentEl = h('div', { class: 'main' });
  root.replaceChildren(...[
    h('div', { class: 'top' },
      h('span', { class: 'brand' }, 'SnipBoard'),
      h('span', { class: 'role' }, admin ? 'Admin' : 'Operator'),
      search,
      h('div', { class: 'tabs' }, tab('board', 'Items'), tab('tools', 'Text tools'), admin && tab('settings', 'Settings')),
      platform.canMini && h('button', { 'aria-pressed': String(ui.mini), title: 'Small window that stays on top of other programs',
        onclick: async () => { ui.mini = !ui.mini; await platform.setMini(ui.mini); render(); } }, ui.mini ? 'Full window' : 'Mini window'),
      h('button', { onclick: () => lock() }, 'Lock')),
    ui.view !== 'settings' && h('div', { class: 'stylebar' },
      h('span', { class: 'muted' }, 'Copy style:'),
      STYLES.map((s) => h('button', { class: 'chip', title: s.sample, 'aria-pressed': String(ui.style === s.id),
        onclick: () => { ui.style = s.id; render(); } }, s.label))),
    h('div', { class: 'body' },
      ui.view === 'board' ? h('nav', { class: 'side', 'aria-label': 'Folders' }, sideTree()) : null,
      contentEl)].filter(Boolean));
  renderContent();
}

function render() {
  contentEl = null;
  if (!file) renderSetup();
  else if (!session) renderLogin();
  else renderMain();
}

// ---------- auto-lock ----------

for (const ev of ['pointerdown', 'keydown', 'pointermove', 'wheel', 'touchstart']) {
  window.addEventListener(ev, () => { lastActive = Date.now(); }, { passive: true, capture: true });
}
setInterval(() => {
  if (!session) return;
  const min = data.settings.autoLockMin;
  if (min > 0 && Date.now() - lastActive > min * 60000) lock('Locked after ' + min + ' minute(s) without use.');
}, 5000);

// ---------- start ----------

(async () => {
  const stored = await platform.loadVault();
  file = isVault(stored) ? stored : null;
  render();
})();
