/** Inline SVG icons (24px grid, currentColor) — no icon font, works offline. */

const SVG_NS = 'http://www.w3.org/2000/svg';

const PATHS = {
  graph: 'M12 5a2 2 0 1 0 0-.01M5 17a2 2 0 1 0 0-.01M19 17a2 2 0 1 0 0-.01M12 7l-6 8M12 7l6 8M7 17h10',
  people: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5M16 4.3a3.5 3.5 0 0 1 0 6.4M18.5 14.8c1.6.8 2.7 2.6 3 5.2',
  connect: 'M7 7h10l-3-3M17 17H7l3 3',
  me: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21c.8-4 4-6.5 8-6.5s7.2 2.5 8 6.5',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4',
  close: 'M6 6l12 12M18 6 6 18',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  shuffle: 'M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  share: 'M12 4v11M8 8l4-4 4 4M5 13v6h14v-6',
  phone: 'M7 3h10v18H7zM11 18h2',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  chat: 'M4 5h16v11H9l-5 4z',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18',
  swap: 'M7 4v16M4 7l3-3 3 3M17 20V4M14 17l3 3 3-3',
  trash: 'M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13',
  plus: 'M12 5v14M5 12h14',
  backup: 'M12 3v12M8 11l4 4 4-4M5 17v3h14v-3',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName, label?: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '24');
  svg.setAttribute('height', '24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  if (label === undefined) {
    svg.setAttribute('aria-hidden', 'true');
  } else {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  }
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', PATHS[name]);
  svg.append(path);
  return svg;
}

/** The self-drawing success check (see .check in styles.css). */
export function checkIcon(): SVGSVGElement {
  const svg = icon('check');
  svg.classList.add('check');
  svg.setAttribute('stroke-width', '2.4');
  return svg;
}

/** Friendly empty-state illustration: a few people joined by threads. */
export function networkIllustration(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `
    <g stroke="var(--color-social)" stroke-width="2" stroke-linecap="round">
      <line x1="60" y1="60" x2="28" y2="34"/><line x1="60" y1="60" x2="94" y2="36"/>
      <line x1="60" y1="60" x2="30" y2="90"/><line x1="60" y1="60" x2="92" y2="88"/>
      <line x1="28" y1="34" x2="94" y2="36" stroke="var(--color-family)" stroke-dasharray="3 5"/>
    </g>
    <circle cx="60" cy="60" r="14" fill="var(--color-primary)"/>
    <circle cx="28" cy="34" r="9" fill="var(--color-accent)"/>
    <circle cx="94" cy="36" r="9" fill="var(--color-secondary)"/>
    <circle cx="30" cy="90" r="9" fill="var(--color-family)"/>
    <circle cx="92" cy="88" r="9" fill="var(--color-social)"/>`;
  return svg;
}
