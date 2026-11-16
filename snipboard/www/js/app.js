import { STYLES, applyStyle } from './textcase.js';
import * as V from './vault.js';
import { parseCsv, rowsToRecords, toCsv, TEMPLATE } from './io.js';
import { platform } from './platform.js';
import { icon } from './icons.js';

const root = document.getElementById('app');
const toastEl = document.getElementById('toast');

let file = null;      // encrypted vault as stored on disk
let session = null;   // { role, raw, dk } while the app is unlocked
let data = null;      // { folders, items, settings } - tablet text inside is still encrypted
const plain = new Map();       // tablet id -> readable text (only for tablets that are open)
const folderKeys = new Map();  // folder id -> { raw, key } for password folders opened this session
const tabKeys = new Map();     // tablet id -> { salt, key } for password tablets opened this session
const ui = { view: 'board', folderId: null, search: '', folderSearch: '', style: 'normal', mini: false, sort: 'oldest' };
try { ui.sort = localStorage.getItem('snipboard-sort') || 'oldest'; } catch { /* keep default */ }

const SORTS = [['oldest', 'Oldest first'], ['newest', 'Newest first'], ['az', 'Name A to Z'], ['za', 'Name Z to A']];
function sorted(list) {
  const out = list.slice();
  if (ui.sort === 'newest') out.reverse();
  else if (ui.sort === 'az' || ui.sort === 'za') {
    out.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true }));
    if (ui.sort === 'za') out.reverse();
  }
  return out;
}
function sortPicker() {
  const el = h('select', { id: 'sort', class: 'sortsel', 'aria-label': 'Sort tablets', title: 'Sort tablets',
    onchange: () => { ui.sort = el.value; try { localStorage.setItem('snipboard-sort', ui.sort); } catch { /* not saved */ } renderContent(); } },
    SORTS.map(([v, l]) => h('option', { value: v }, 'Sort: ' + l)));
  el.value = SORTS.some(([v]) => v === ui.sort) ? ui.sort : 'oldest';
  return el;
}
let contentEl = null;
let copybarEl = null;
let lastCopy = null;
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

// Icon-only button: the label is the tooltip and the screen-reader name.
const ib = (name, label, onclick, cls = '') => h('button', { type: 'button', class: 'ib ' + cls, title: label, 'aria-label': label, onclick }, icon(name));
// Icon + text button.
const tb = (name, label, onclick, cls = '') => h('button', { type: 'button', class: 'tb ' + cls, onclick }, icon(name), h('span', {}, label));

let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

// Modal form. Resolves to an object of values, or null when cancelled. validate may be async.
function form({ title, text, fields = [], ok = 'Save', danger = false, validate }) {
  return new Promise((resolve) => {
    const inputs = {};
    const err = h('div', { class: 'error' });
    const okBtn = h('button', { type: 'submit', class: danger ? 'primary danger' : 'primary' }, ok);
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
        : h('div', {}, h('label', {}, f.label, input), f.hint && h('div', { class: 'hint' }, f.hint));
    });
    const close = (val) => { dlg.close(); dlg.remove(); resolve(val); };
    const dlg = h('dialog', {},
      h('form', { method: 'dialog', onsubmit: async (e) => {
        e.preventDefault();
        const vals = {};
        for (const f of fields) vals[f.name] = f.type === 'checkbox' ? inputs[f.name].checked : inputs[f.name].value;
        okBtn.disabled = true;
        const problem = validate && await validate(vals);
        okBtn.disabled = false;
        if (problem) { err.textContent = problem; return; }
        close(vals);
      } },
        h('h3', {}, title),
        text && h('div', { class: 'muted' }, text),
        body, err,
        h('div', { class: 'btns' }, h('button', { type: 'button', onclick: () => close(null) }, 'Cancel'), okBtn)));
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

// ---------- folders ----------

const kids = (parentId) => data.folders.filter((f) => f.parentId === parentId);
const folderById = (id) => data.folders.find((f) => f.id === id);

function pathOf(folderId) {
  const parts = [];
  for (let f = folderById(folderId); f; f = folderById(f.parentId)) parts.unshift(f.name);
  return parts;
}

// A folder can be opened when every password folder on the way to it has been unlocked.
function accessible(folderId) {
  for (let f = folderById(folderId); f; f = folderById(f.parentId)) if (f.lock && !folderKeys.has(f.id)) return false;
  return true;
}

// Which key protects a tablet stored in this folder: the nearest password folder, else the app itself.
function gov(folderId) {
  for (let f = folderById(folderId); f; f = folderById(f.parentId)) if (f.lock) return f.id;
  return 'vault';
}
const keyFor = (by) => (by === 'vault' ? session.dk : folderKeys.get(by) && folderKeys.get(by).key);

// Folder list for the tree. Contents of a locked folder stay hidden.
function flatFolders(parentId = null, depth = 0, out = []) {
  for (const f of kids(parentId)) { out.push({ f, depth }); if (accessible(f.id)) flatFolders(f.id, depth + 1, out); }
  return out;
}

function descendants(id, out = new Set([id])) {
  for (const f of kids(id)) { out.add(f.id); descendants(f.id, out); }
  return out;
}

const folderOptions = (exclude = new Set()) => [
  { value: '', label: 'Home (top level)' },
  ...flatFolders().filter(({ f }) => !exclude.has(f.id) && accessible(f.id))
    .map(({ f, depth }) => ({ value: f.id, label: '  '.repeat(depth + 1) + f.name })),
];

// Walks (and creates) a folder path for import. Returns undefined when a locked folder is in the way.
function resolvePath(parts) {
  let parentId = null;
  for (const name of parts) {
    let f = data.folders.find((x) => x.parentId === parentId && x.name.toLowerCase() === name.toLowerCase());
    if (!f) { f = { id: uid(), name, parentId }; data.folders.push(f); }
    if (!accessible(f.id)) return undefined;
    parentId = f.id;
  }
  return parentId;
}

// ---------- tablets: every tablet's text is encrypted on its own ----------

const selfLocked = (t) => !!t.enc && t.enc.by === 'self';
const isHidden = (t) => t.sensitive || selfLocked(t);
const visibleItems = () => data.items.filter((t) => accessible(t.folderId));

async function sealItem(t) {
  const text = plain.get(t.id);
  if (text === undefined) throw new Error('locked');
  if (selfLocked(t)) {
    const k = tabKeys.get(t.id);
    if (!k) throw new Error('locked');
    t.enc = { by: 'self', salt: k.salt, ...(await V.encText(k.key, text)) };
  } else {
    const by = gov(t.folderId), key = keyFor(by);
    if (!key) throw new Error('locked');
    t.enc = { by, ...(await V.encText(key, text)) };
  }
  delete t.value;
}

// After folders move or passwords change, re-encrypt tablets whose protecting key changed.
async function rekey() {
  for (const t of data.items) {
    if ('value' in t || !t.enc || (!selfLocked(t) && t.enc.by !== gov(t.folderId))) await sealItem(t);
  }
}

async function openWith(by, key) {
  await Promise.all(data.items.filter((t) => t.enc && t.enc.by === by).map(async (t) => plain.set(t.id, await V.decText(key, t.enc))));
}

async function commit() {
  file = await V.saveData(file, session, data);
  await platform.saveVault(file);
}

// Run an admin change; if anything fails, put the data back exactly as it was.
async function change(fn) {
  const snap = JSON.stringify(data);
  try {
    await fn();
    await rekey();
    await commit();
    return true;
  } catch (e) {
    data = JSON.parse(snap);
    toast(e && e.message === 'locked' ? 'Unlock the password folders involved first. Nothing was changed.' : 'Could not save. Nothing was changed.');
    return false;
  }
}

// ---------- lock / unlock the app ----------

function lock(msg) {
  session = null; data = null; lastCopy = null; // a pending clipboard-clear timer keeps running on purpose
  plain.clear(); folderKeys.clear(); tabKeys.clear();
  document.querySelectorAll('dialog').forEach((d) => d.remove());
  ui.view = 'board'; ui.search = ''; ui.folderSearch = ''; ui.folderId = null;
  render();
  if (msg) toast(msg);
}

function renderSetup() {
  const mk = (id) => h('input', { type: 'password', autocomplete: 'new-password', id });
  const a1 = mk('set-a1'), a2 = mk('set-a2'), o1 = mk('set-o1'), o2 = mk('set-o2');
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
    const made = await V.createVault(a1.value, o1.value, start);
    try { await platform.saveVault(made.file); } catch { toast('This device is not saving data. It will be lost when you close the app.'); }
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
  const pw = h('input', { type: 'password', autocomplete: 'current-password', id: 'login-pw' });
  const err = h('div', { class: 'error' });
  const btn = h('button', { class: 'primary', type: 'submit' }, 'Unlock');
  root.replaceChildren(h('form', { class: 'auth', onsubmit: async (e) => {
    e.preventDefault();
    btn.disabled = true; btn.textContent = 'Checking…'; err.textContent = '';
    const res = await V.unlock(file, pw.value);
    if (!res) {
      btn.disabled = false; btn.textContent = 'Unlock';
      err.textContent = 'Wrong password.'; pw.select();
      return;
    }
    session = res.session; data = res.data;
    data.settings = { ...DEFAULT_SETTINGS, ...data.settings };
    for (const t of data.items) if ('value' in t) plain.set(t.id, t.value); // data saved by version 1.0
    await openWith('vault', session.dk);
    lastActive = Date.now();
    render();
  } },
    h('h1', {}, 'SnipBoard'),
    h('div', { class: 'muted' }, 'Enter your Admin or Operator password.'),
    h('label', {}, 'Password', pw),
    err, btn));
  pw.focus();
}

// ---------- passwords on single tablets and folders ----------

// Makes sure a password tablet is open, asking for its password when needed.
async function ensureOpen(t) {
  if (plain.has(t.id)) return true;
  if (!selfLocked(t)) return false;
  const vals = await form({ title: 'Password for "' + t.label + '"', ok: 'Open',
    fields: [{ name: 'pw', label: 'Tablet password', type: 'password' }],
    validate: async (v) => {
      try {
        const k = await V.passwordKey(v.pw, t.enc.salt, file.iter);
        plain.set(t.id, await V.decText(k.key, t.enc));
        tabKeys.set(t.id, k);
        return '';
      } catch { return 'Wrong password.'; }
    } });
  return !!vals;
}

async function unlockFolder(f) {
  const vals = await form({ title: 'Password for folder "' + f.name + '"', ok: 'Open folder',
    fields: [{ name: 'pw', label: 'Folder password', type: 'password' }],
    validate: async (v) => {
      const k = await V.openFolderLock(f.lock, v.pw, file.iter);
      if (!k) return 'Wrong password.';
      folderKeys.set(f.id, k);
      await openWith(f.id, k.key);
      return '';
    } });
  if (vals) render();
}

function closeFolder(f) {
  for (const t of data.items) if (t.enc && t.enc.by === f.id) plain.delete(t.id);
  folderKeys.delete(f.id);
  render();
  toast('Folder "' + f.name + '" is locked again.');
}

const pwFields = (what) => [
  { name: 'p1', label: 'New password for this ' + what, type: 'password' },
  { name: 'p2', label: 'Repeat password', type: 'password' },
];
const pwProblem = (v) => (v.p1.length < 4 ? 'Use at least 4 characters.' : v.p1 !== v.p2 ? 'The two passwords do not match.' : '');
const PW_WARNING = 'There is no way to recover this password. If it is forgotten, the protected text is lost.';

async function tabletPassword(t) {
  if (!await ensureOpen(t)) return;
  const has = selfLocked(t);
  const vals = await form({ title: (has ? 'Change' : 'Set') + ' password for "' + t.label + '"', text: PW_WARNING, ok: 'Save',
    fields: [
      has && { name: 'action', label: 'What to do', type: 'select', value: 'change', options: [{ value: 'change', label: 'Change the password' }, { value: 'remove', label: 'Remove the password' }] },
      ...pwFields('tablet'),
    ].filter(Boolean),
    validate: (v) => (v.action === 'remove' ? '' : pwProblem(v)) });
  if (!vals) return;
  const ok = await change(async () => {
    if (vals.action === 'remove') { tabKeys.delete(t.id); t.enc = null; }
    else { tabKeys.set(t.id, await V.passwordKey(vals.p1, null, file.iter)); t.enc = { by: 'self' }; }
    await sealItem(t);
  });
  if (ok) { renderContent(); toast(vals.action === 'remove' ? 'Password removed.' : 'Password saved.'); }
}

async function folderPassword(f) {
  const has = !!f.lock;
  const vals = await form({ title: (has ? 'Change' : 'Set') + ' password for folder "' + f.name + '"',
    text: 'Everything inside the folder is encrypted with this password. ' + PW_WARNING, ok: 'Save',
    fields: [
      has && { name: 'action', label: 'What to do', type: 'select', value: 'change', options: [{ value: 'change', label: 'Change the password' }, { value: 'remove', label: 'Remove the password' }] },
      ...pwFields('folder'),
    ].filter(Boolean),
    validate: (v) => (v.action === 'remove' ? '' : pwProblem(v)) });
  if (!vals) return;
  const ok = await change(async () => {
    if (vals.action === 'remove') delete f.lock;
    else if (has) f.lock = await V.relockFolder(folderKeys.get(f.id).raw, vals.p1, file.iter);
    else { const k = await V.newFolderLock(vals.p1, file.iter); f.lock = k.lock; folderKeys.set(f.id, { raw: k.raw, key: k.key }); }
  });
  if (!ok) { if (!has) folderKeys.delete(f.id); return; }
  if (vals.action === 'remove') folderKeys.delete(f.id);
  render();
  toast(vals.action === 'remove' ? 'Password removed.' : 'Password saved.');
}

// ---------- copy ----------

function updateCopybar() {
  if (!copybarEl) return;
  const c = lastCopy;
  if (!c) {
    copybarEl.replaceChildren(icon('copy'), h('span', { class: 'muted' }, 'Nothing copied yet. Click a tablet to copy its text.'));
    return;
  }
  copybarEl.replaceChildren(
    icon(c.cleared ? 'x' : 'check'),
    h('div', { class: 'what' },
      h('div', { class: 'lbl' }, (c.cleared ? 'Cleared from clipboard' : 'Copied') + (c.name ? ' · ' + c.name : '') + ' · ' + c.style),
      h('div', { class: 'txt' }, c.hidden && !c.show ? '••••••••' : c.text)),
    c.hidden && ib('eye', c.show ? 'Hide the copied text' : 'Show the copied text', () => { c.show = !c.show; updateCopybar(); }),
    !c.cleared && ib('x', 'Clear the clipboard now', async () => { clearTimeout(clipTimer); await platform.clearClipboardIf(c.text); c.cleared = true; updateCopybar(); }));
}

async function copyText(text, styleId, name, hidden, tile) {
  const c = applyStyle(styleId, text);
  try { await platform.copy(c); } catch { toast('Could not copy. Try again.'); return; }
  const style = STYLES.find((s) => s.id === styleId);
  const { clipClearSec, clipClearScope } = data.settings;
  const willClear = clipClearSec > 0 && (clipClearScope === 'all' || hidden);
  const mine = lastCopy = { name, text: c.text, style: style.label, hidden, show: false, cleared: false };
  clearTimeout(clipTimer);
  if (willClear) clipTimer = setTimeout(async () => { await platform.clearClipboardIf(c.text); mine.cleared = true; if (lastCopy === mine) updateCopybar(); }, clipClearSec * 1000);
  updateCopybar();
  toast('Copied' + (name ? ': ' + name : '') + (willClear ? ' · clears in ' + clipClearSec + 's' : ''));
  if (tile) { tile.classList.add('copied'); setTimeout(() => tile.classList.remove('copied'), 900); }
}

async function copyItem(t, styleId, tile) {
  const wasOpen = plain.has(t.id);
  if (!await ensureOpen(t)) return;
  if (!wasOpen) renderContent();
  await copyText(plain.get(t.id), styleId, t.label, isHidden(t), wasOpen ? tile : null);
}

function styleMenu(t) {
  const close = () => { dlg.close(); dlg.remove(); };
  const dlg = h('dialog', { class: 'menu' },
    h('div', { class: 'muted' }, 'Copy "' + t.label + '" as'),
    STYLES.map((s) => h('button', { type: 'button', onclick: () => { close(); copyItem(t, s.id); } }, s.label, h('small', {}, s.sample))),
    h('button', { type: 'button', class: 'muted', onclick: close }, 'Cancel'));
  dlg.addEventListener('cancel', () => dlg.remove());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  document.body.append(dlg);
  dlg.showModal();
}

// ---------- admin actions on tablets ----------

async function editItem(t) {
  const isNew = !t;
  if (t && !await ensureOpen(t)) return;
  const vals = await form({
    title: isNew ? 'New tablet' : 'Edit tablet',
    fields: [
      { name: 'label', label: 'Tablet name', value: t ? t.label : '' },
      { name: 'value', label: 'Text saved in this tablet (this is what gets copied)', type: 'textarea', value: t ? plain.get(t.id) : '' },
      isNew && { name: 'folderId', label: 'Keep it in folder', type: 'select', value: ui.folderId || '', options: folderOptions() },
      { name: 'sensitive', label: 'Hide the text on screen and clear it from the clipboard after copying', type: 'checkbox', value: t ? t.sensitive : false },
      isNew && { name: 'p1', label: 'Tablet password (optional)', type: 'password', hint: 'Leave empty for no password. With a password, the text can only be copied after typing it.' },
      isNew && { name: 'p2', label: 'Repeat tablet password', type: 'password' },
    ].filter(Boolean),
    validate: (v) => (!v.label.trim() ? 'Please enter a tablet name.' : !v.value.trim() ? 'Please enter the text to save.'
      : isNew && v.p1 ? pwProblem(v) : ''),
  });
  if (!vals) return;
  const ok = await change(async () => {
    const item = t || { id: uid() };
    if (isNew) data.items.push(item);
    Object.assign(item, { label: vals.label.trim(), sensitive: vals.sensitive });
    if (isNew) item.folderId = vals.folderId || null;
    plain.set(item.id, vals.value);
    if (isNew && vals.p1) { tabKeys.set(item.id, await V.passwordKey(vals.p1, null, file.iter)); item.enc = { by: 'self' }; }
    await sealItem(item);
  });
  if (ok) { renderContent(); toast(isNew ? 'Tablet saved.' : 'Changes saved.'); }
}

// Moving a tablet to another folder always needs the Admin password, whoever is logged in.
async function moveTablet(t) {
  const vals = await form({ title: 'Move tablet "' + t.label + '"', ok: 'Move',
    text: 'Moving a tablet needs the Admin password every time.',
    fields: [
      { name: 'folderId', label: 'Move it to folder', type: 'select', value: t.folderId || '', options: folderOptions() },
      { name: 'pw', label: 'Admin password', type: 'password' },
    ],
    validate: async (v) => {
      if ((v.folderId || null) === t.folderId) return 'Choose a different folder.';
      const res = await V.unlock(file, v.pw);
      return res && res.role === 'admin' ? '' : 'Wrong Admin password.';
    } });
  if (!vals) return;
  const ok = await change(() => { data.items.find((x) => x.id === t.id).folderId = vals.folderId || null; });
  if (ok) { renderContent(); toast('Moved to ' + ['Home', ...pathOf(vals.folderId || null)].join(' / ') + '.'); }
}

async function renameItem(t) {
  const vals = await form({ title: 'Rename tablet', ok: 'Rename',
    fields: [{ name: 'label', label: 'New name', value: t.label }],
    validate: (v) => (!v.label.trim() ? 'Please enter a name.' : '') });
  if (!vals) return;
  if (await change(() => { t.label = vals.label.trim(); })) renderContent();
}

async function deleteItem(t) {
  if (!await confirmBox('Delete tablet?', '"' + t.label + '" will be removed permanently.', 'Delete', true)) return;
  if (await change(() => { data.items = data.items.filter((x) => x.id !== t.id); })) renderContent();
}

// ---------- admin actions on folders ----------

async function newFolder(parentId) {
  const vals = await form({ title: 'New folder', ok: 'Create folder',
    fields: [
      { name: 'name', label: 'Folder name', value: '' },
      { name: 'parentId', label: 'Create it inside', type: 'select', value: parentId || '', options: folderOptions() },
      { name: 'p1', label: 'Folder password (optional)', type: 'password', hint: 'Leave empty for no password. With a password, the folder must be unlocked before its tablets can be seen.' },
      { name: 'p2', label: 'Repeat folder password', type: 'password' },
    ],
    validate: (v) => (!v.name.trim() ? 'Please enter a folder name.' : v.p1 ? pwProblem(v) : '') });
  if (!vals) return;
  const f = { id: uid(), name: vals.name.trim(), parentId: vals.parentId || null };
  const ok = await change(async () => {
    if (vals.p1) { const k = await V.newFolderLock(vals.p1, file.iter); f.lock = k.lock; folderKeys.set(f.id, { raw: k.raw, key: k.key }); }
    data.folders.push(f);
  });
  if (ok) { ui.folderId = f.id; render(); toast('Folder created.'); }
}

async function renameFolder(f) {
  const vals = await form({ title: 'Rename folder', ok: 'Rename',
    fields: [{ name: 'name', label: 'New name', value: f.name }],
    validate: (v) => (!v.name.trim() ? 'Please enter a name.' : '') });
  if (!vals) return;
  if (await change(() => { folderById(f.id).name = vals.name.trim(); })) render();
}

async function moveFolder(f) {
  const vals = await form({ title: 'Move folder "' + f.name + '"', ok: 'Move',
    fields: [{ name: 'parentId', label: 'Move it inside', type: 'select', value: f.parentId || '', options: folderOptions(descendants(f.id)) }] });
  if (!vals) return;
  if (await change(() => { folderById(f.id).parentId = vals.parentId || null; })) render();
}

async function deleteFolder(f) {
  const ids = descendants(f.id);
  const n = data.items.filter((x) => ids.has(x.folderId)).length;
  const text = 'This also deletes ' + (ids.size - 1) + ' folder(s) and ' + n + ' tablet(s) inside it. This cannot be undone.';
  if (!await confirmBox('Delete folder "' + f.name + '"?', text, 'Delete everything', true)) return;
  const ok = await change(() => {
    data.folders = data.folders.filter((x) => !ids.has(x.id));
    data.items = data.items.filter((x) => !ids.has(x.folderId));
  });
  if (ok) { ui.folderId = f.parentId; render(); }
}

// ---------- board ----------

function tile(t, showPath) {
  const admin = isAdmin();
  const open = plain.has(t.id);
  const el = h('div', { class: 'tile' },
    h('button', { class: 'hit', title: 'Click to copy', onclick: () => copyItem(t, ui.style, el) },
      showPath && h('span', { class: 'path' }, ['Home', ...pathOf(t.folderId)].join(' / ')),
      h('span', { class: 'name' }, selfLocked(t) && icon(open ? 'unlock' : 'lock'), t.label),
      h('span', { class: 'value' }, !open ? 'Password needed to copy' : isHidden(t) ? '••••••••' : plain.get(t.id))),
    h('div', { class: 'acts' },
      ib('type', 'Copy in another style', () => styleMenu(t)),
      admin && ib('tag', 'Rename tablet', () => renameItem(t)),
      admin && ib('pencil', 'Edit tablet', () => editItem(t)),
      admin && ib('key', selfLocked(t) ? 'Change or remove tablet password' : 'Set a password for this tablet', () => tabletPassword(t)),
      ib('move', 'Move to another folder', () => moveTablet(t)),
      admin && ib('trash', 'Delete tablet', () => deleteItem(t), 'danger')));
  return el;
}

function renderBoard() {
  const admin = isAdmin();
  if (ui.folderId && !folderById(ui.folderId)) ui.folderId = null;
  const q = ui.search.trim().toLowerCase();
  if (q) {
    const hits = visibleItems().filter((t) => t.label.toLowerCase().includes(q)
      || (!isHidden(t) && (plain.get(t.id) || '').toLowerCase().includes(q))
      || pathOf(t.folderId).join(' / ').toLowerCase().includes(q));
    return [
      h('div', { class: 'folderbar' }, h('h2', {}, hits.length + ' result' + (hits.length === 1 ? '' : 's') + ' for "' + ui.search.trim() + '"'), h('span', { class: 'spacer' }), sortPicker()),
      hits.length ? h('div', { class: 'grid' }, sorted(hits).map((t) => tile(t, true))) : h('div', { class: 'empty' }, 'Nothing matches. Try a shorter word.'),
    ];
  }
  const f = folderById(ui.folderId);
  const sel = h('select', { 'aria-label': 'Folder', id: 'folder-select', onchange: () => { ui.folderId = sel.value || null; ui.folderSearch = ''; render(); } });
  const fillSel = () => {
    const found = folderMatches();
    const opts = found
      ? [{ value: '', label: found.length + ' folder(s) found - choose one' }, ...found.map((x) => ({ value: x.id, label: (x.lock ? '🔒 ' : '') + pathOf(x.id).join(' / ') }))]
      : [{ value: '', label: 'Home' }, ...flatFolders().map(({ f: x, depth }) => ({ value: x.id, label: '  '.repeat(depth + 1) + (x.lock ? '🔒 ' : '') + x.name }))];
    sel.replaceChildren(...opts.map((o) => h('option', { value: o.value }, o.label)));
    sel.value = found ? '' : ui.folderId || '';
  };
  fillSel();
  const fsearch = h('input', { type: 'search', id: 'folder-search-m', placeholder: 'Search folders…', 'aria-label': 'Search folders', value: ui.folderSearch,
    oninput: () => { ui.folderSearch = fsearch.value; fillSel(); } });
  const title = h('h2', {}, ['Home', ...pathOf(ui.folderId)].join(' / '));

  if (f && !accessible(f.id)) {
    return [
      h('div', { class: 'foldersel' }, fsearch, sel),
      h('div', { class: 'folderbar' }, title),
      h('div', { class: 'lockpane' }, icon('lock'),
        h('div', {}, 'This folder is protected by a password.'),
        tb('unlock', 'Unlock folder', () => unlockFolder(f), 'primary'),
        admin && tb('trash', 'Delete folder', () => deleteFolder(f), 'danger')),
    ];
  }

  const items = data.items.filter((t) => t.folderId === ui.folderId);
  const subs = kids(ui.folderId);
  return [
    h('div', { class: 'foldersel' }, fsearch, sel),
    h('div', { class: 'folderbar' },
      title,
      h('span', { class: 'spacer' }),
      sortPicker(),
      admin && tb('plus', 'New tablet', () => editItem(null), 'primary'),
      admin && tb('folderPlus', 'New folder', () => newFolder(ui.folderId)),
      admin && f && ib('tag', 'Rename folder', () => renameFolder(f)),
      admin && f && ib('move', 'Move folder', () => moveFolder(f)),
      admin && f && ib('key', f.lock ? 'Change or remove folder password' : 'Set a password for this folder', () => folderPassword(f)),
      f && f.lock && ib('lock', 'Lock this folder again', () => closeFolder(f)),
      admin && f && ib('trash', 'Delete folder', () => deleteFolder(f), 'danger')),
    subs.length ? h('div', { class: 'subs' }, subs.map((s) => tb(s.lock && !folderKeys.has(s.id) ? 'lock' : 'folder', s.name, () => { ui.folderId = s.id; render(); }))) : null,
    items.length ? h('div', { class: 'grid' }, sorted(items).map((t) => tile(t, false)))
      : h('div', { class: 'empty' },
        h('div', {}, admin ? 'No tablets here yet. A tablet holds one piece of text that you can copy with one click.' : 'No tablets in this folder.'),
        admin && tb('plus', 'Create a tablet', () => editItem(null), 'primary')),
  ];
}

// ---------- text tools ----------

function renderTools() {
  const input = h('textarea', { rows: 6, id: 'tools-input', placeholder: 'Type or paste any text here…', 'aria-label': 'Text to convert' });
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
      tb('x', 'Clear', () => { input.value = ''; input.focus(); })))];
}

// ---------- settings (admin) ----------

async function changePassword(role) {
  const name = role === 'admin' ? 'Admin' : 'Operator';
  const vals = await form({ title: 'Change ' + name + ' password', ok: 'Change password',
    fields: [{ name: 'p1', label: 'New ' + name + ' password', type: 'password' }, { name: 'p2', label: 'Repeat it', type: 'password' }],
    validate: (v) => (v.p1.length < 6 ? 'Use at least 6 characters.' : v.p1 !== v.p2 ? 'The two passwords do not match.' : '') });
  if (!vals) return;
  const clash = await V.unlock(file, vals.p1);
  if (clash && clash.role !== role) { toast('That password is already used by the other role. Nothing changed.'); return; }
  file = await V.setPassword(file, session, role, vals.p1);
  await platform.saveVault(file);
  toast(name + ' password changed.');
}

const today = () => new Date().toISOString().slice(0, 10);
const openRecords = () => visibleItems().filter((t) => plain.has(t.id))
  .map((t) => ({ path: pathOf(t.folderId), label: t.label, value: plain.get(t.id), sensitive: !!t.sensitive }));

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
  const sig = (r) => JSON.stringify([r.path.map((p) => p.toLowerCase()), r.label, r.value]);
  const have = new Set(openRecords().map(sig));
  const fresh = records.filter((r) => !have.has(sig(r)));
  if (!fresh.length) { toast('Nothing new to import.'); return; }
  const text = fresh.length + ' new tablet(s) will be added. ' + (records.length - fresh.length) + ' already exist and '
    + skipped + ' row(s) have no name or value, so they are skipped.';
  if (!await confirmBox('Import from ' + f.name + '?', text, 'Import')) return;
  let blocked = 0;
  const ok = await change(async () => {
    for (const r of fresh) {
      const folderId = resolvePath(r.path);
      if (folderId === undefined) { blocked++; continue; }
      const t = { id: uid(), folderId, label: r.label, sensitive: r.sensitive };
      plain.set(t.id, r.value);
      data.items.push(t);
      await sealItem(t);
    }
  });
  if (!ok) return;
  render();
  toast('Imported ' + (fresh.length - blocked) + ' tablet(s).' + (blocked ? ' ' + blocked + ' skipped: their folder is locked.' : ''));
}

async function restoreBackup() {
  const f = await pickFile('');
  if (!f) return;
  let obj;
  try { obj = JSON.parse(await f.text()); } catch { obj = null; }
  if (!V.isVault(obj)) { toast('That is not a SnipBoard backup file.'); return; }
  const text = 'Everything on this device is replaced by the backup. You will then log in with the passwords that were in use when the backup was made.';
  if (!await confirmBox('Restore backup?', text, 'Replace my data', true)) return;
  await platform.saveVault(obj);
  file = obj;
  lock('Backup restored. Please log in.');
}

function renderSettings() {
  const s = data.settings;
  const save = async () => { if (await change(() => {})) toast('Saved.'); };
  const pick = (id, label, value, options, set) => {
    const el = h('select', { id, 'aria-label': label, onchange: () => { set(el.value); save(); } }, options.map(([v, l]) => h('option', { value: v }, l)));
    el.value = value;
    return el;
  };
  return [
    h('div', { class: 'panel' },
      h('h3', {}, 'App passwords'),
      h('div', { class: 'muted' }, 'Admin can change everything. Operators can only view and copy. Passwords for single tablets and folders are set with the key button on each one.'),
      h('div', { class: 'row' },
        tb('key', 'Change Admin password', () => changePassword('admin')),
        tb('key', 'Change Operator password', () => changePassword('operator')))),
    h('div', { class: 'panel' },
      h('h3', {}, 'Auto-lock and clipboard'),
      h('div', { class: 'row' }, 'Lock the app when nobody uses it for',
        pick('set-lock', 'Auto-lock', s.autoLockMin, [[1, '1 minute'], [5, '5 minutes'], [15, '15 minutes'], [30, '30 minutes'], [0, 'Never']], (v) => { s.autoLockMin = +v; })),
      h('div', { class: 'row' }, 'Clear copied text from the clipboard after',
        pick('set-clip', 'Clear clipboard after', s.clipClearSec, [[15, '15 seconds'], [30, '30 seconds'], [60, '1 minute'], [0, 'Never']], (v) => { s.clipClearSec = +v; }),
        'for',
        pick('set-scope', 'Which tablets', s.clipClearScope, [['sensitive', 'Hidden and password tablets only'], ['all', 'Everything copied']], (v) => { s.clipClearScope = v; }))),
    h('div', { class: 'panel' },
      h('h3', {}, 'Backup'),
      h('div', { class: 'muted' }, 'The backup file is encrypted. It opens only with the passwords in use today.'),
      h('div', { class: 'row' },
        tb('save', 'Save backup file', async () => { if (await platform.saveFile('snipboard-backup-' + today() + '.snipbackup', JSON.stringify(file), 'application/json')) toast('Backup saved.'); }),
        tb('upload', 'Restore from backup…', restoreBackup, 'danger'))),
    h('div', { class: 'panel' },
      h('h3', {}, 'Excel / CSV'),
      h('div', { class: 'muted' }, 'Sheet columns: Folder, Name, Value, Sensitive. Folder can be a path such as "Company / Bank".'),
      h('div', { class: 'row' },
        tb('upload', 'Import from Excel or CSV…', importSheet),
        tb('save', 'Download sample sheet', () => platform.saveFile('snipboard-template.csv', toCsv(TEMPLATE), 'text/csv')),
        tb('save', 'Export tablets to CSV', async () => {
          const recs = openRecords();
          const left = data.items.length - recs.length;
          const text = 'The CSV file is NOT encrypted. Anyone who opens it can read every tablet in it.'
            + (left ? ' ' + left + ' tablet(s) that are still locked by their own or a folder password are left out.' : '');
          if (!await confirmBox('Export ' + recs.length + ' tablet(s)?', text, 'Export')) return;
          platform.saveFile('snipboard-tablets-' + today() + '.csv', toCsv(recs), 'text/csv');
        }))),
  ];
}

// ---------- shell ----------

function renderContent() {
  if (!contentEl) return;
  const view = ui.view === 'settings' && isAdmin() ? renderSettings() : ui.view === 'tools' ? renderTools() : renderBoard();
  contentEl.replaceChildren(...view.filter(Boolean));
}

// Folders whose name matches the folder search box (null when the box is empty).
function folderMatches() {
  const q = ui.folderSearch.trim().toLowerCase();
  return q ? flatFolders().map(({ f }) => f).filter((f) => f.name.toLowerCase().includes(q)) : null;
}

function sideTree() {
  const found = folderMatches();
  if (found) {
    if (!found.length) return [h('div', { class: 'empty small' }, 'No folder has that name.')];
    return found.map((f) => h('button', { class: 'node found', 'aria-current': ui.folderId === f.id ? 'true' : null,
      onclick: () => { ui.folderId = f.id; ui.search = ''; ui.folderSearch = ''; ui.view = 'board'; render(); } },
      icon(f.lock ? (folderKeys.has(f.id) ? 'unlock' : 'lock') : 'folder'),
      h('span', {}, f.name, h('small', {}, ['Home', ...pathOf(f.parentId)].join(' / ')))));
  }
  const node = (id, name, depth, ic) => h('button', { class: 'node d' + Math.min(depth, 6), 'aria-current': ui.folderId === id && !ui.search ? 'true' : null,
    onclick: () => { ui.folderId = id; ui.search = ''; ui.view = 'board'; render(); } }, icon(ic), h('span', {}, name));
  return [node(null, 'Home', 0, 'home'),
    ...flatFolders().map(({ f, depth }) => node(f.id, f.name, depth + 1, f.lock ? (folderKeys.has(f.id) ? 'unlock' : 'lock') : 'folder'))];
}

function renderMain() {
  const admin = isAdmin();
  const search = h('input', { class: 'search', type: 'search', id: 'search', placeholder: 'Search all tablets…', 'aria-label': 'Search all tablets', value: ui.search,
    oninput: () => { ui.search = search.value; ui.view = 'board'; renderContent(); } });
  const tab = (id, ic, label) => h('button', { class: 'tb', title: label, 'aria-label': label, 'aria-pressed': String(ui.view === id), onclick: () => { ui.view = id; ui.search = ''; render(); } }, icon(ic), h('span', {}, label));
  const tree = h('div', { class: 'tree' }, sideTree());
  const fsearch = h('input', { type: 'search', id: 'folder-search', placeholder: 'Search folders…', 'aria-label': 'Search folders', value: ui.folderSearch,
    oninput: () => { ui.folderSearch = fsearch.value; tree.replaceChildren(...sideTree()); } });
  const side = h('nav', { class: 'side', 'aria-label': 'Folders' }, fsearch, tree);
  contentEl = h('div', { class: 'main' });
  copybarEl = h('div', { class: 'copybar', 'aria-live': 'polite' });
  root.replaceChildren(...[
    h('div', { class: 'top' },
      h('span', { class: 'brand' }, 'SnipBoard'),
      h('span', { class: 'role' }, admin ? 'Admin' : 'Operator'),
      search,
      h('div', { class: 'tabs' }, tab('board', 'grid', 'Tablets'), tab('tools', 'type', 'Text tools'), admin && tab('settings', 'sliders', 'Settings')),
      platform.canMini && h('button', { class: 'ib', 'aria-pressed': String(ui.mini), 'aria-label': ui.mini ? 'Full window' : 'Mini window',
        title: ui.mini ? 'Back to the full window' : 'Mini window that stays on top of other programs',
        onclick: async () => { ui.mini = !ui.mini; await platform.setMini(ui.mini); render(); } }, icon('pip')),
      ib('lock', 'Lock the app', () => lock())),
    ui.view !== 'settings' && h('div', { class: 'stylebar' },
      h('span', { class: 'muted' }, 'Copy style:'),
      STYLES.map((s) => h('button', { class: 'chip', title: s.sample, 'aria-pressed': String(ui.style === s.id),
        onclick: () => { ui.style = s.id; render(); } }, s.label))),
    h('div', { class: 'body' },
      ui.view === 'board' ? side : null,
      contentEl),
    ui.view !== 'settings' && copybarEl].filter(Boolean));
  renderContent();
  updateCopybar();
}

function render() {
  contentEl = null; copybarEl = null;
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
  file = V.isVault(stored) ? stored : null;
  render();
})();
