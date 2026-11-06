import { h } from './dom';

/**
 * Avatars: initials on a soft hue derived from the name (stable per person),
 * with the person's group colours drawn as a ring around them.
 * Used both in HTML lists and, as SVG data URIs, as graph node images.
 */

export function initials(name: string): string {
  const words = name
    .replace(/\(.*?\)/g, ' ')
    .split(/\s+/)
    .map((word) => [...word].find((char) => /\p{L}/u.test(char)))
    .filter((char): char is string => char !== undefined);
  const picked = words.length >= 2 ? [words[0], words[words.length - 1]] : words.slice(0, 1);
  return picked.join('').toUpperCase() || '?';
}

export function hueFor(name: string): number {
  let hash = 0;
  for (const char of name) {
    hash = (Math.imul(hash, 31) + (char.codePointAt(0) as number)) | 0;
  }
  return Math.abs(hash) % 360;
}

type Theme = 'light' | 'dark';

export function currentTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function colors(name: string, theme: Theme): { background: string; foreground: string } {
  const hue = hueFor(name);
  return theme === 'dark'
    ? { background: `hsl(${hue} 32% 30%)`, foreground: `hsl(${hue} 70% 88%)` }
    : { background: `hsl(${hue} 60% 90%)`, foreground: `hsl(${hue} 45% 26%)` };
}

function ringGradient(ringColors: readonly string[]): string {
  const step = 100 / ringColors.length;
  const stops = ringColors.map((color, i) => `${color} ${i * step}% ${(i + 1) * step}%`);
  return `conic-gradient(${stops.join(', ')})`;
}

export type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';

export function avatar(name: string, ringColors: readonly string[], size: AvatarSize = 'md', isMe = false): HTMLElement {
  const { background, foreground } = colors(name, currentTheme());
  const element = h('span', { class: `avatar avatar-${size}${isMe ? ' is-me' : ''}`, 'aria-hidden': 'true' }, initials(name));
  element.style.setProperty('--avatar-bg', background);
  element.style.setProperty('--avatar-fg', foreground);
  if (ringColors.length > 0) {
    element.dataset['ring'] = '';
    element.style.setProperty('--ring', ringGradient(ringColors));
  }
  return element;
}

const svgCache = new Map<string, string>();

function escapeXml(text: string): string {
  return text.replace(/[<>&'"]/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** SVG data URI for a graph node: disc with initials, group colours as ring segments. */
export function avatarDataUri(name: string, ringColors: readonly string[], theme: Theme): string {
  const key = `${theme}|${name}|${ringColors.join(',')}`;
  const cached = svgCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const { background, foreground } = colors(name, theme);
  const radius = 45;
  const circumference = 2 * Math.PI * radius;
  const segment = ringColors.length === 0 ? 0 : circumference / ringColors.length;
  const ring = ringColors
    .map(
      (color, i) =>
        `<circle cx="50" cy="50" r="${radius}" fill="none" stroke="${color}" stroke-width="10" ` +
        `stroke-dasharray="${segment} ${circumference - segment}" stroke-dashoffset="${-i * segment}" transform="rotate(-90 50 50)"/>`,
    )
    .join('');
  const discRadius = ringColors.length === 0 ? 48 : 38;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">${ring}` +
    `<circle cx="50" cy="50" r="${discRadius}" fill="${background}"/>` +
    `<text x="50" y="51" text-anchor="middle" dominant-baseline="central" font-family="Rubik, system-ui, sans-serif" ` +
    `font-size="${initials(name).length > 1 ? 32 : 38}" font-weight="600" fill="${foreground}">${escapeXml(initials(name))}</text></svg>`;
  const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  svgCache.set(key, uri);
  return uri;
}
