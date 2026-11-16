// Text style conversions used by the copy buttons and the Text Tools panel.

const LETTER = /\p{L}/u;

export function toUpper(s) { return s.toLocaleUpperCase(); }
export function toLower(s) { return s.toLocaleLowerCase(); }

// "Company name here. Next sentence." - first letter of each sentence capital, rest small.
export function toSentence(s) {
  let out = '';
  let capNext = true;
  for (const ch of s.toLocaleLowerCase()) {
    if (capNext && LETTER.test(ch)) { out += ch.toLocaleUpperCase(); capNext = false; }
    else { out += ch; }
    if (ch === '.' || ch === '!' || ch === '?' || ch === '\n') capNext = true;
  }
  return out;
}

// "Company Name Here" - first letter of every word capital, rest small.
export function toTitle(s) {
  let out = '';
  let capNext = true;
  for (const ch of s.toLocaleLowerCase()) {
    if (LETTER.test(ch) || /\p{N}/u.test(ch) || ch === "'" || ch === '’') {
      out += capNext ? ch.toLocaleUpperCase() : ch;
      capNext = false;
    } else { out += ch; capNext = true; }
  }
  return out;
}

// Italic look-alike letters (Unicode "mathematical sans-serif italic"). English A-Z / a-z only.
export function toUnicodeItalic(s) {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c >= 65 && c <= 90) out += String.fromCodePoint(0x1d608 + c - 65);
    else if (c >= 97 && c <= 122) out += String.fromCodePoint(0x1d622 + c - 97);
    else out += ch;
  }
  return out;
}

export function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const STYLES = [
  { id: 'normal', label: 'Normal', sample: 'As saved' },
  { id: 'upper', label: 'BIG', sample: 'ALL CAPITAL' },
  { id: 'lower', label: 'small', sample: 'all small' },
  { id: 'sentence', label: 'First capital', sample: 'First letter capital' },
  { id: 'title', label: 'Each Word', sample: 'Each Word Capital' },
  { id: 'italic', label: 'Italic', sample: 'Real italic (Word, email)' },
  { id: 'uitalic', label: 'Italic ✱', sample: 'Italic letters (paste anywhere)' },
];

// Returns { text, html? } - html is only set for real (rich-text) italic.
export function applyStyle(styleId, s) {
  switch (styleId) {
    case 'upper': return { text: toUpper(s) };
    case 'lower': return { text: toLower(s) };
    case 'sentence': return { text: toSentence(s) };
    case 'title': return { text: toTitle(s) };
    case 'uitalic': return { text: toUnicodeItalic(s) };
    case 'italic': return { text: s, html: '<i>' + escapeHtml(s).replace(/\n/g, '<br>') + '</i>' };
    default: return { text: s };
  }
}
