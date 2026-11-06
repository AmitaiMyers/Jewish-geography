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

export function nextGroupColor(usedColors: readonly string[]): string {
  const unused = GROUP_COLORS.find((color) => !usedColors.includes(color));
  return unused ?? (GROUP_COLORS[usedColors.length % GROUP_COLORS.length] as string);
}
