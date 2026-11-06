import { assert } from '../model/assert';

/**
 * Bloom filter: a compact bit set that answers "is this item probably in the set?"
 * It never misses a real member; it says "yes" for a non-member with a small,
 * tunable probability. ~11 bits per item give ≈0.5% false positives, so 500
 * contacts fit in well under 1 KB — small enough for one QR code.
 *
 * Indexes use double hashing (Kirsch–Mitzenmacher): index_i = h1 + i·h2 mod m.
 * A random salt per filter means two filters of the same contacts look unrelated.
 */

export interface BloomFilter {
  bits: Uint8Array;
  bitCount: number;
  hashCount: number;
  salt: number;
}

const MAX_HASHES = 16;

/** cyrb53: fast, well-distributed 53-bit string hash. */
function cyrb53(text: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

function indexes(filter: Pick<BloomFilter, 'bitCount' | 'hashCount' | 'salt'>, item: string): number[] {
  const h1 = cyrb53(item, filter.salt) % 4294967296;
  // ">>> 0" keeps h2 unsigned: "| 1" alone would turn large values negative.
  const h2 = ((cyrb53(item, filter.salt ^ 0x9e3779b9) % 4294967296) | 1) >>> 0;
  return Array.from({ length: filter.hashCount }, (_, i) => (h1 + i * h2) % filter.bitCount);
}

/** Bits and hash count for `itemCount` items at `falsePositiveRate`, never above `maxBits`. */
export function bloomParameters(itemCount: number, falsePositiveRate: number, maxBits: number): { bitCount: number; hashCount: number } {
  assert(falsePositiveRate > 0 && falsePositiveRate < 1, 'false positive rate must be between 0 and 1');
  assert(maxBits >= 8, 'a filter needs at least 8 bits');
  const items = Math.max(1, itemCount);
  const ideal = Math.ceil((-items * Math.log(falsePositiveRate)) / Math.LN2 ** 2);
  const bitCount = Math.min(maxBits, Math.max(64, Math.ceil(ideal / 8) * 8));
  const hashCount = Math.min(MAX_HASHES, Math.max(1, Math.round((bitCount / items) * Math.LN2)));
  return { bitCount, hashCount };
}

export function createBloomFilter(items: Iterable<string>, bitCount: number, hashCount: number, salt: number): BloomFilter {
  assert(bitCount % 8 === 0 && bitCount > 0, 'bit count must be a positive multiple of 8');
  assert(hashCount >= 1 && hashCount <= MAX_HASHES, `hash count must be 1..${MAX_HASHES}`);
  const filter: BloomFilter = { bits: new Uint8Array(bitCount / 8), bitCount, hashCount, salt: salt >>> 0 };
  for (const item of items) {
    for (const index of indexes(filter, item)) {
      filter.bits[index >> 3] = (filter.bits[index >> 3] as number) | (1 << (index & 7));
    }
  }
  return filter;
}

export function bloomHas(filter: BloomFilter, item: string): boolean {
  return indexes(filter, item).every((index) => ((filter.bits[index >> 3] as number) & (1 << (index & 7))) !== 0);
}
