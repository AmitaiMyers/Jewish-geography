import { assert } from '../model/assert';
import { identityKeys, normalizeEmail, normalizePhone } from '../model/identity';
import type { Person } from '../model/types';
import { bloomParameters, createBloomFilter, type BloomFilter } from './bloom';

/**
 * What one user hands another to compare graphs (by QR code, file or pasted text):
 *  - their name and their own phone/email, so the receiver can recognise them;
 *  - a Bloom filter of everyone they know — never the list itself.
 *
 * Binary layout (then base64url, prefixed "JG1:"):
 *   u8 version | u8 hashCount | u32 salt | u32 bitCount
 *   u8 nameLength | name (utf-8)
 *   u8 phoneCount | (u8 length | utf-8)*   — normalised digits
 *   u8 emailCount | (u8 length | utf-8)*   — lowercased
 *   filter bytes (bitCount / 8)
 */

export const PAYLOAD_PREFIX = 'JG1:';
const VERSION = 1;
/** Characters that still scan reliably from a phone screen (QR version ≈ 33, low error correction). */
export const QR_MAX_CHARACTERS = 2000;
const FALSE_POSITIVE_RATE = 0.005;
const MAX_NAME_CHARACTERS = 60;
const MAX_OWN_IDENTIFIERS = 4;

export interface ComparePayload {
  name: string;
  phones: string[];
  emails: string[];
  filter: BloomFilter;
}

/** Everyone I know, as identity keys (same keys used for duplicate detection). */
export function contactKeys(people: readonly Person[], meId: string): string[] {
  return [...new Set(people.filter((person) => person.id !== meId).flatMap(identityKeys))];
}

export function buildPayload(me: Person, people: readonly Person[], salt: number = randomSalt()): ComparePayload {
  const keys = contactKeys(people, me.id);
  const name = [...me.name].slice(0, MAX_NAME_CHARACTERS).join('');
  const phones = me.phones.map(normalizePhone).filter((phone) => phone.length > 0).slice(0, MAX_OWN_IDENTIFIERS);
  const emails = me.emails.map(normalizeEmail).filter((email) => email.length > 0).slice(0, MAX_OWN_IDENTIFIERS);

  const headerBytes = encodeHeader(name, phones, emails).length + 10;
  const budgetBytes = Math.floor(((QR_MAX_CHARACTERS - PAYLOAD_PREFIX.length) * 3) / 4) - headerBytes;
  const { bitCount, hashCount } = bloomParameters(keys.length, FALSE_POSITIVE_RATE, Math.max(8, budgetBytes * 8));
  return { name, phones, emails, filter: createBloomFilter(keys, bitCount, hashCount, salt) };
}

function randomSalt(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] as number;
}

function encodeString(text: string): number[] {
  const bytes = new TextEncoder().encode(text);
  assert(bytes.length <= 255, 'text field too long for payload');
  return [bytes.length, ...bytes];
}

function encodeHeader(name: string, phones: string[], emails: string[]): number[] {
  return [
    ...encodeString(name),
    phones.length,
    ...phones.flatMap(encodeString),
    emails.length,
    ...emails.flatMap(encodeString),
  ];
}

function u32(value: number): number[] {
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
}

export function encodePayload(payload: ComparePayload): string {
  const { filter } = payload;
  const bytes = Uint8Array.from([
    VERSION,
    filter.hashCount,
    ...u32(filter.salt),
    ...u32(filter.bitCount),
    ...encodeHeader(payload.name, payload.phones, payload.emails),
    ...filter.bits,
  ]);
  return PAYLOAD_PREFIX + toBase64Url(bytes);
}

class Reader {
  private offset = 0;
  constructor(private readonly bytes: Uint8Array) {}

  u8(): number {
    assert(this.offset < this.bytes.length, 'code is cut short');
    return this.bytes[this.offset++] as number;
  }

  u32(): number {
    return ((this.u8() << 24) | (this.u8() << 16) | (this.u8() << 8) | this.u8()) >>> 0;
  }

  text(): string {
    const length = this.u8();
    return new TextDecoder().decode(this.take(length));
  }

  take(length: number): Uint8Array {
    assert(this.offset + length <= this.bytes.length, 'code is cut short');
    const slice = this.bytes.slice(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }

  get remaining(): number {
    return this.bytes.length - this.offset;
  }
}

/** Parses a scanned/pasted code. Throws a readable error for anything that is not ours. */
export function decodePayload(raw: string): ComparePayload {
  const text = raw.trim();
  assert(text.startsWith(PAYLOAD_PREFIX), 'this is not a Pitzuchim code');
  const reader = new Reader(fromBase64Url(text.slice(PAYLOAD_PREFIX.length)));
  assert(reader.u8() === VERSION, 'this code was made by a newer version of the app');
  const hashCount = reader.u8();
  const salt = reader.u32();
  const bitCount = reader.u32();
  assert(bitCount > 0 && bitCount % 8 === 0, 'code is damaged (filter size)');
  assert(hashCount >= 1 && hashCount <= 16, 'code is damaged (hash count)');
  const name = reader.text();
  const phones = Array.from({ length: reader.u8() }, () => reader.text());
  const emails = Array.from({ length: reader.u8() }, () => reader.text());
  assert(reader.remaining === bitCount / 8, 'code is damaged (filter length)');
  return { name, phones, emails, filter: { bits: reader.take(bitCount / 8), bitCount, hashCount, salt } };
}

function toBase64Url(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  assert(/^[A-Za-z0-9_-]*$/.test(text), 'code contains unexpected characters');
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}
