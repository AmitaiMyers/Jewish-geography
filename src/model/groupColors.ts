/** Distinct, colour-blind-friendly hues for group clusters (readable in light and dark mode). */
export const GROUP_COLORS = [
  '#2f6fdf',
  '#e8833a',
  '#2ba37a',
  '#d4477a',
  '#8a5cd6',
  '#c9a227',
  '#1fa3b8',
  '#b5523b',
  '#6b8f2a',
  '#7a7f8c',
] as const;

/** The preset hues first; after that, new hues spaced by the golden angle so groups stay distinguishable. */
export function nextGroupColor(usedColors: readonly string[]): string {
  const unused = GROUP_COLORS.find((color) => !usedColors.includes(color));
  return unused ?? hslToHex((usedColors.length * 137.508) % 360, 0.55, 0.5);
}

/** Hex (not hsl) because group colours are edited with <input type="color">. */
function hslToHex(hue: number, saturation: number, lightness: number): string {
  const channel = (n: number): string => {
    const k = (n + hue / 30) % 12;
    const a = saturation * Math.min(lightness, 1 - lightness);
    const value = lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}
