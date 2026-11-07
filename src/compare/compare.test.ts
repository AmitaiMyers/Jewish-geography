import { describe, expect, it } from 'vitest';
import type { Person } from '../model/types';
import { bloomHas, bloomParameters, createBloomFilter } from './bloom';
import { findOverlap } from './overlap';
import { buildPayload, decodePayload, encodePayload, PAYLOAD_PREFIX, QR_MAX_CHARACTERS } from './payload';

function person(id: string, name: string, phones: string[] = [], emails: string[] = []): Person {
  return { id, name, gender: 'unknown', phones, emails, groupIds: [], otherNames: [], notes: '', source: 'manual', createdAt: 0 };
}

const phone = (i: number): string => `05${String(i).padStart(8, '0')}`;

describe('bloom filter', () => {
  it('never misses a member and keeps false positives near the target', () => {
    const members = Array.from({ length: 500 }, (_, i) => `p:${i}`);
    const { bitCount, hashCount } = bloomParameters(members.length, 0.005, 1 << 20);
    const filter = createBloomFilter(members, bitCount, hashCount, 42);
    expect(members.every((item) => bloomHas(filter, item))).toBe(true);
    const strangers = Array.from({ length: 20000 }, (_, i) => `stranger:${i}`);
    const falsePositives = strangers.filter((item) => bloomHas(filter, item)).length / strangers.length;
    expect(falsePositives).toBeLessThan(0.01);
  });

  it('respects the size cap', () => {
    expect(bloomParameters(10000, 0.005, 8000).bitCount).toBe(8000);
  });
});

describe('payload', () => {
  const me = person('me', 'Amitai Myers', ['+972 54-999-0000'], ['Amitai@Example.com']);
  const people = [me, ...Array.from({ length: 500 }, (_, i) => person(`p${i}`, `Person ${i}`, [phone(i)]))];

  it('round-trips through text and fits in one QR code for 500 contacts', () => {
    const encoded = encodePayload(buildPayload(me, people, 7));
    expect(encoded.startsWith(PAYLOAD_PREFIX)).toBe(true);
    expect(encoded.length).toBeLessThanOrEqual(QR_MAX_CHARACTERS);
    const decoded = decodePayload(encoded);
    expect(decoded.name).toBe('Amitai Myers');
    expect(decoded.phones).toEqual(['972549990000']);
    expect(decoded.emails).toEqual(['amitai@example.com']);
  });

  it('still fits for 3000 contacts by accepting more false positives', () => {
    const many = [me, ...Array.from({ length: 3000 }, (_, i) => person(`p${i}`, `P${i}`, [phone(i)]))];
    expect(encodePayload(buildPayload(me, many, 1)).length).toBeLessThanOrEqual(QR_MAX_CHARACTERS);
  });

  it.each([
    ['hello', /not a Jewish Geography code/],
    [`${PAYLOAD_PREFIX}AQ`, /cut short/],
    [`${PAYLOAD_PREFIX}*!`, /unexpected characters/],
  ])('rejects %s', (text, error) => {
    expect(() => decodePayload(text)).toThrow(error);
  });
});

describe('findOverlap', () => {
  // Friend's graph: knows Sarah (by phone, different format) and Dina (by email).
  const friendMe = person('f-me', 'Yossi', ['052-111-2222']);
  const friendPeople = [
    friendMe,
    person('f1', 'Sarah', ['+972 54 123 4567']),
    person('f2', 'Dina D', [], ['dina@example.com']),
    person('f3', 'Only friend knows', ['050-000-0001']),
  ];
  const payload = decodePayload(encodePayload(buildPayload(friendMe, friendPeople, 99)));

  const mine = [
    person('me', 'Amitai'),
    person('m1', 'Sarah Cohen', ['054-123-4567']),
    person('m2', 'Dina', [], ['DINA@example.com']),
    person('m3', 'Only I know', ['050-000-0002']),
    person('m4', 'Yossi from shul', ['0521112222']),
  ];

  it('finds the people we both know and recognises the friend', () => {
    const overlap = findOverlap(payload, mine, 'me');
    expect(overlap.friendId).toBe('m4');
    expect(overlap.commonIds.sort()).toEqual(['m1', 'm2']);
  });
});
