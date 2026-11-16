// One small interface over the three places the app runs: Windows (Electron),
// Android (Capacitor) and a plain browser (used for development and tests).

const native = globalThis.snipNative;
const cap = globalThis.Capacitor && globalThis.Capacitor.isNativePlatform && globalThis.Capacitor.isNativePlatform()
  ? globalThis.Capacitor : null;
const VAULT = 'snipboard-vault.json';
const fsPlugin = cap && cap.registerPlugin('Filesystem');
const sharePlugin = cap && cap.registerPlugin('Share');

async function webCopy({ text, html }) {
  try {
    if (html && globalThis.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({
        'text/plain': new Blob([text], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      })]);
      return;
    }
    await navigator.clipboard.writeText(text);
  } catch {
    // Older WebViews: fall back to a hidden selection.
    const el = document.createElement(html ? 'div' : 'textarea');
    if (html) { el.innerHTML = html; el.contentEditable = 'true'; } else { el.value = text; }
    el.style.cssText = 'position:fixed;left:-9999px;top:0;white-space:pre';
    document.body.appendChild(el);
    if (html) {
      const r = document.createRange(); r.selectNodeContents(el);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    } else { el.select(); }
    const ok = document.execCommand('copy');
    el.remove();
    if (!ok) throw new Error('Copy was blocked');
  }
}

async function webClearIf(text) {
  try {
    const now = await navigator.clipboard.readText();
    if (now !== text) return;
  } catch { /* cannot read: clear anyway */ }
  try { await navigator.clipboard.writeText(' '); } catch { /* ignore */ }
}

function webDownload(name, content, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return true;
}

const electron = native && {
  name: 'windows',
  canMini: true,
  loadVault: () => native.loadVault(),
  saveVault: (obj) => native.saveVault(obj),
  copy: (c) => native.copy(c),
  clearClipboardIf: (t) => native.clearIf(t),
  saveFile: (name, content) => native.saveFile(name, content),
  setMini: (on) => native.setMini(on),
};

const android = cap && {
  name: 'android',
  canMini: false,
  async loadVault() {
    try {
      const r = await fsPlugin.readFile({ path: VAULT, directory: 'DATA', encoding: 'utf8' });
      return JSON.parse(r.data);
    } catch { return null; }
  },
  async saveVault(obj) {
    await fsPlugin.writeFile({ path: VAULT, directory: 'DATA', encoding: 'utf8', data: JSON.stringify(obj) });
  },
  copy: webCopy,
  clearClipboardIf: webClearIf,
  async saveFile(name, content) {
    const r = await fsPlugin.writeFile({ path: name, directory: 'CACHE', encoding: 'utf8', data: content });
    await sharePlugin.share({ title: name, url: r.uri });
    return true;
  },
  setMini: async () => {},
};

const browser = {
  name: 'browser',
  canMini: false,
  async loadVault() { try { return JSON.parse(localStorage.getItem(VAULT)); } catch { return null; } },
  async saveVault(obj) { localStorage.setItem(VAULT, JSON.stringify(obj)); },
  copy: webCopy,
  clearClipboardIf: webClearIf,
  saveFile: async (name, content, mime) => webDownload(name, content, mime || 'text/plain'),
  setMini: async () => {},
};

export const platform = electron || android || browser;
