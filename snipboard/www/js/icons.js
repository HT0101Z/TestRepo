// Small line icons (24x24, drawn with strokes).
const P = {
  plus: ['M12 5v14M5 12h14'],
  copy: ['M9 9h11v11H9z', 'M5 15H4V4h11v1'],
  check: ['M5 12l5 5 9-10'],
  x: ['M6 6l12 12M18 6L6 18'],
  pencil: ['M4 20h4L19 9l-4-4L4 16v4z', 'M13.5 6.5l4 4'],
  tag: ['M3 12V4h8l10 10-8 8z', 'M7.5 8h.01'],
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13', 'M10 11v6M14 11v6'],
  up: ['M12 19V5M6 11l6-6 6 6'],
  down: ['M12 5v14M6 13l6 6 6-6'],
  folder: ['M3 6h6l2 2h10v11H3z'],
  folderPlus: ['M3 6h6l2 2h10v11H3z', 'M12 11v5M9.5 13.5h5'],
  move: ['M3 6h6l2 2h10v11H3z', 'M8.5 13.5h7M13 11l2.5 2.5L13 16'],
  lock: ['M6 11h12v9H6z', 'M8.5 11V7.5a3.5 3.5 0 017 0V11'],
  unlock: ['M6 11h12v9H6z', 'M8.5 11V7.5a3.5 3.5 0 016.8-1.2'],
  key: ['M12 15a4 4 0 11-8 0 4 4 0 018 0z', 'M11 12l8-8M16 7l3 3M13.5 9.5l2 2'],
  home: ['M4 11l8-7 8 7v9h-5v-6H9v6H4z'],
  eye: ['M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z', 'M12 9a3 3 0 100 6 3 3 0 000-6z'],
  type: ['M5 7V5h14v2', 'M12 5v14M9 19h6'],
  sliders: ['M4 7h10M18 7h2M4 17h2M10 17h10', 'M16 5a2 2 0 100 4 2 2 0 000-4z', 'M8 15a2 2 0 100 4 2 2 0 000-4z'],
  grid: ['M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z'],
  pip: ['M3 5h18v14H3z', 'M12 12h6v4h-6z'],
  save: ['M12 4v11M7 10l5 5 5-5', 'M4 20h16'],
  upload: ['M12 15V4M7 9l5-5 5 5', 'M4 20h16'],
};
const NS = 'http://www.w3.org/2000/svg';

export function icon(name) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'ic');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of P[name] || []) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}
