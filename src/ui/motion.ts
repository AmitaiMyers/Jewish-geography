/**
 * Motion helpers. Every animation goes through here so that
 * "reduce motion" is honoured in one place.
 */

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)');

export function prefersReducedMotion(): boolean {
  return REDUCED.matches;
}

export const DURATION = { fast: 120, base: 220, slow: 450 } as const;
export const EASE_OUT = 'cubic-bezier(.2,.8,.2,1)';
export const EASE_SPRING = 'cubic-bezier(.34,1.56,.64,1)';

/** Duration to use for a JS-driven animation (0 when reduced motion is on). */
export function duration(ms: number): number {
  return prefersReducedMotion() ? 0 : ms;
}

/** Gentle horizontal shake for invalid input; re-triggerable. */
export function shake(element: HTMLElement): void {
  element.classList.remove('shake');
  void element.offsetWidth;
  element.classList.add('shake');
  element.addEventListener('animationend', () => element.classList.remove('shake'), { once: true });
}

/** A short tap on devices with a vibration motor (Android); silently absent elsewhere. */
export function haptic(pattern: number | number[] = 10): void {
  if ('vibrate' in navigator && !prefersReducedMotion()) {
    navigator.vibrate(pattern);
  }
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
