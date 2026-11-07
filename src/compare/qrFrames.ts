import { assert } from '../model/assert';
import { PAYLOAD_PREFIX } from './payload';

/**
 * A compare code can be several kilobytes, too much for one comfortably scannable QR code.
 * It is cut into frames shown one after another on screen; the scanner collects them in any order.
 *   frame text:  "JGQ:<code id>:<index>/<total>:<part of the code>"
 * The id (a short hash of the whole code) keeps frames of two different codes from being mixed.
 * A single "JG1:…" code (pasted or from an older version) is accepted as it is.
 */

export const FRAME_PREFIX = 'JGQ:';
/** Characters per frame: a QR version ≈ 22 at low error correction, quick to scan from a screen. */
export const FRAME_CHARACTERS = 1000;
const FRAME = /^JGQ:([0-9a-z]+):(\d+)\/(\d+):(.*)$/s;

function codeId(code: string): string {
  let hash = 0;
  for (let i = 0; i < code.length; i++) hash = (Math.imul(hash, 31) + code.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

export function toFrames(code: string): string[] {
  const id = codeId(code);
  const total = Math.max(1, Math.ceil(code.length / FRAME_CHARACTERS));
  return Array.from({ length: total }, (_, i) => `${FRAME_PREFIX}${id}:${i + 1}/${total}:${code.slice(i * FRAME_CHARACTERS, (i + 1) * FRAME_CHARACTERS)}`);
}

export function isCompareQr(text: string): boolean {
  return text.startsWith(FRAME_PREFIX) || text.startsWith(PAYLOAD_PREFIX);
}

/** Collects scanned frames; `complete` holds the whole code once every frame has been seen. */
export class FrameCollector {
  private readonly parts = new Map<number, string>();
  private id = '';
  complete: string | null = null;

  /** Returns how many frames are in, and how many are needed. */
  add(text: string): { have: number; need: number } {
    if (text.startsWith(PAYLOAD_PREFIX)) {
      this.complete = text;
      return { have: 1, need: 1 };
    }
    const match = FRAME.exec(text);
    assert(match !== null, 'this is not a Pitzuchim code');
    const id = match[1] as string;
    const index = Number(match[2]);
    const total = Number(match[3]);
    assert(index >= 1 && index <= total, 'code frame is damaged');
    if (this.id !== id) {
      this.parts.clear(); // a different (or regenerated) code: start over
      this.id = id;
    }
    this.parts.set(index, match[4] as string);
    if (this.parts.size === total) {
      this.complete = Array.from({ length: total }, (_, i) => this.parts.get(i + 1) as string).join('');
    }
    return { have: this.parts.size, need: total };
  }
}
