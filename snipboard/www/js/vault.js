// Encrypted vault. Data is encrypted with a random AES-256-GCM key. That key is stored twice,
// once locked by the Admin password and once by the Operator password (PBKDF2-SHA256).

const subtle = globalThis.crypto.subtle;
const ITER = 310000;
const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(buf) {
  const a = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return btoa(s);
}
function unb64(s) {
  const bin = atob(s);
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}
const rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

async function kek(password, salt, iter) {
  const base = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function wrap(rawKey, password, iter) {
  const salt = rand(16), iv = rand(12);
  const k = await kek(password, salt, iter);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, k, rawKey);
  return { salt: b64(salt), iv: b64(iv), key: b64(ct) };
}

async function unwrap(slot, password, iter) {
  try {
    const k = await kek(password, unb64(slot.salt), iter);
    return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: unb64(slot.iv) }, k, unb64(slot.key)));
  } catch { return null; }
}

const importDK = (raw) => subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);

async function seal(dk, data) {
  const iv = rand(12);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, dk, enc.encode(JSON.stringify(data)));
  return { iv: b64(iv), ct: b64(ct) };
}

export function isVault(obj) {
  return !!obj && obj.app === 'snipboard' && obj.v === 1 && obj.admin && obj.operator && obj.data;
}

export async function createVault(adminPw, operatorPw, data, iter = ITER) {
  const raw = rand(32);
  const file = {
    app: 'snipboard', v: 1, iter,
    admin: await wrap(raw, adminPw, iter),
    operator: await wrap(raw, operatorPw, iter),
    data: await seal(await importDK(raw), data),
  };
  return { file, session: { role: 'admin', raw, dk: await importDK(raw) } };
}

// Returns { role, data, session } or null when the password matches neither role.
export async function unlock(file, password) {
  for (const role of ['admin', 'operator']) {
    const raw = await unwrap(file[role], password, file.iter);
    if (!raw) continue;
    const dk = await importDK(raw);
    const pt = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(file.data.iv) }, dk, unb64(file.data.ct));
    return { role, data: JSON.parse(dec.decode(pt)), session: { role, raw, dk } };
  }
  return null;
}

export async function saveData(file, session, data) {
  return { ...file, data: await seal(session.dk, data) };
}

export async function setPassword(file, session, role, newPw) {
  return { ...file, [role]: await wrap(session.raw, newPw, file.iter) };
}

// ---------- per-tablet and per-folder protection ----------

// Encrypt / decrypt one piece of text with an AES-GCM key.
export async function encText(key, text) {
  const iv = rand(12);
  return { iv: b64(iv), ct: b64(await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text))) };
}
export async function decText(key, box) {
  return dec.decode(await subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.ct)));
}

// Key made directly from a password (used by a tablet that has its own password).
export async function passwordKey(password, salt, iter) {
  const s = salt ? unb64(salt) : rand(16);
  return { salt: b64(s), key: await kek(password, s, iter) };
}

// A folder password protects a random folder key; tablets in the folder are encrypted with that key.
export async function newFolderLock(password, iter) {
  const raw = rand(32);
  return { lock: await wrap(raw, password, iter), raw, key: await importDK(raw) };
}
export async function openFolderLock(lock, password, iter) {
  const raw = await unwrap(lock, password, iter);
  return raw ? { raw, key: await importDK(raw) } : null;
}
export const relockFolder = (raw, password, iter) => wrap(raw, password, iter);
