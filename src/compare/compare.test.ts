import { describe, expect, it } from 'vitest';
import type { Person } from '../model/types';
import { bloomHas, bloomParameters, createBloomFilter } from './bloom';
import { findOverlap } from './overlap';
import { buildPayload, decodePayload, encodePayload, PAYLOAD_PREFIX } from './payload';
import { FRAME_CHARACTERS, FrameCollector, toFrames } from './qrFrames';

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

  it('round-trips through text', () => {
    const encoded = encodePayload(buildPayload(me, people, 7));
    expect(encoded.startsWith(PAYLOAD_PREFIX)).toBe(true);
    const decoded = decodePayload(encoded);
    expect(decoded.name).toBe('Amitai Myers');
    expect(decoded.phones).toEqual(['972549990000']);
    expect(decoded.emails).toEqual(['amitai@example.com']);
  });

  it('keeps false matches near 1 in 1,000 even for 3,000 contacts', () => {
    const many = [me, ...Array.from({ length: 3000 }, (_, i) => person(`p${i}`, `P${i}`, [phone(i)]))];
    const strangers = Array.from({ length: 3000 }, (_, i) => person(`s${i}`, `S${i}`, [phone(100000 + i)]));
    const filter = decodePayload(encodePayload(buildPayload(me, many, 1)));
    const falseMatches = findOverlap(filter, strangers, 'none').commonIds.length;
    expect(falseMatches).toBeLessThan(10);
  });

  it('splits a large code into QR frames that reassemble in any order', () => {
    const many = [me, ...Array.from({ length: 1800 }, (_, i) => person(`p${i}`, `P${i}`, [phone(i)]))];
    const code = encodePayload(buildPayload(me, many, 3));
    const frames = toFrames(code);
    expect(frames.length).toBeGreaterThan(1);
    frames.forEach((frame) => expect(frame.length).toBeLessThanOrEqual(FRAME_CHARACTERS + 30));
    const collector = new FrameCollector();
    const progress = [...frames].reverse().map((frame) => collector.add(frame));
    expect(progress[0]).toEqual({ have: 1, need: frames.length });
    expect(collector.complete).toBe(code);
  });

  it('never mixes frames of two different codes', () => {
    const many = [me, ...Array.from({ length: 1800 }, (_, i) => person(`p${i}`, `P${i}`, [phone(i)]))];
    const first = toFrames(encodePayload(buildPayload(me, many, 1)));
    const second = toFrames(encodePayload(buildPayload(me, many, 2)));
    const collector = new FrameCollector();
    collector.add(first[0] as string);
    second.forEach((frame) => collector.add(frame));
    expect(collector.complete).toBe(second.map((frame) => frame.replace(/^JGQ:[^:]+:\d+\/\d+:/, '')).join(''));
  });

  it.each([
    ['hello', /not a Pitzuchim code/],
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
