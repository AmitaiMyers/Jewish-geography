import { describe, expect, it } from 'vitest';
import type { Person } from '../model/types';
import { phoneMatchKey } from '../model/identity';
import { parseVCards } from './vcard';
import { parseWhatsAppChat } from './whatsapp';
import { parseFacebookFriends, repairFacebookText } from './facebook';
import { findPersonByName, parseNameHints, suggestionsFromName } from './nameHints';

function person(id: string, name: string): Person {
  return { id, name, gender: 'unknown', phones: [], emails: [], groupIds: [], otherNames: [], notes: '', source: 'manual', createdAt: 0 };
}

describe('phoneMatchKey', () => {
  it('matches local and international forms of the same number', () => {
    expect(phoneMatchKey('054-123-4567')).toBe(phoneMatchKey('+972 54 123 4567'));
    expect(phoneMatchKey('00972541234567')).toBe(phoneMatchKey('054 1234567'));
  });
});

describe('parseVCards', () => {
  it('reads names, phones, emails, folding and quoted-printable', () => {
    const text = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'N:Cohen;Moshe;;;',
      'FN:Moshe Cohen',
      'item1.TEL;type=CELL:+972 54-123-4567',
      'EMAIL;type=INTERNET:moshe@example.com',
      'END:VCARD',
      'BEGIN:VCARD',
      'VERSION:2.1',
      'N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=D7=9C=D7=95=D7=99;=D7=A9=D7=A8=D7=94;;;',
      'TEL;CELL:052-765-',
      ' 4321',
      'END:VCARD',
      'BEGIN:VCARD',
      'END:VCARD',
    ].join('\r\n');
    expect(parseVCards(text)).toEqual([
      { name: 'Moshe Cohen', phones: ['+972 54-123-4567'], emails: ['moshe@example.com'] },
      { name: 'שרה לוי', phones: ['052-765-4321'], emails: [] },
    ]);
  });
});

describe('parseWhatsAppChat', () => {
  it('collects unique senders from iOS and Android formats', () => {
    const text = [
      '[12/03/2024, 14:05:33] Moshe Cohen: shalom',
      '‎[12/03/2024, 14:06:01] Sarah: hi',
      '12/03/2024, 14:05 - Moshe Cohen: again',
      '3/12/24, 2:05 PM - +972 54-123-4567: who is this',
      '12/03/2024, 14:00 - Messages and calls are end-to-end encrypted.',
      'a continuation line: not a message',
    ].join('\n');
    const chat = parseWhatsAppChat(text, 'WhatsApp Chat with Cousins.txt');
    expect(chat.chatName).toBe('Cousins');
    expect(chat.contacts).toEqual([
      { name: 'Moshe Cohen', phones: [], emails: [] },
      { name: 'Sarah', phones: [], emails: [] },
      { name: '+972 54-123-4567', phones: ['+972 54-123-4567'], emails: [] },
    ]);
  });
});

describe('parseFacebookFriends', () => {
  it('reads friends_v2 and repairs Facebook text encoding', () => {
    const garbled = String.fromCharCode(...new TextEncoder().encode('שרה'));
    const json = JSON.stringify({ friends_v2: [{ name: 'Avi Levi', timestamp: 1 }, { name: garbled, timestamp: 2 }] });
    expect(parseFacebookFriends(json).map((c) => c.name)).toEqual(['Avi Levi', 'שרה']);
  });

  it('leaves correct text untouched', () => {
    expect(repairFacebookText('שרה')).toBe('שרה');
  });

  it('fails fast on the wrong file', () => {
    expect(() => parseFacebookFriends('{"messages": []}')).toThrow(/friends_v2/);
  });
});

describe('parseNameHints', () => {
  it.each([
    ['Mom', 'mom', null],
    ['Uncle Moshe', 'uncle', null],
    ['Avi Levi (cousin)', 'cousin', null],
    ['Dina - sister', 'sister', null],
    ['בת דודה רחל', 'בת דודה', null],
    ['Rivka (Sarah’s mom)', 'mom', 'Sarah'],
    ['Yossi dad of Avi Levi', 'dad', 'Avi Levi'],
    ['משה אבא של שרה', 'אבא', 'שרה'],
    ['אמא שאול', 'אמא', 'שאול'],
    ['אמא של רז😉', 'אמא', 'רז'],
    ['עינב קוטלר אמא של פטל', 'אמא', 'פטל'],
    ['סבתא', 'סבתא', null],
  ])('%s', (name, word, anchor) => {
    const [hint] = parseNameHints(name);
    expect(hint?.word).toBe(word);
    expect(hint?.anchorName).toBe(anchor);
  });

  it.each(['Moshe Cohen', 'דוד כהן', 'Bank of America', 'Avi’s Pizza'])('finds nothing in "%s"', (name) => {
    expect(parseNameHints(name)).toEqual([]);
  });
});

describe('suggestionsFromName', () => {
  const people = [person('me', 'Amitai'), person('sarah', 'Sarah Cohen'), person('rivka', 'Rivka (Sarah’s mom)')];

  it('links the subject to the named person with the right direction', () => {
    const [suggestion] = suggestionsFromName(people[2] as Person, people, 'me');
    expect(suggestion).toMatchObject({ from: 'rivka', to: 'sarah', type: 'parent', genderHint: 'female' });
  });

  it('reads "אמא שאול" as Shaul\'s mother, and drops it when there is no Shaul', () => {
    const shaul = person('shaul', 'שאול כהן');
    const shaulsMom = person('mom', 'אמא שאול');
    expect(suggestionsFromName(shaulsMom, [...people, shaul, shaulsMom], 'me')[0]).toMatchObject({ from: 'mom', to: 'shaul', type: 'parent' });
    const placeMom = person('m2', 'אמא אפיקים בנגב');
    expect(suggestionsFromName(placeMom, [...people, placeMom], 'me')).toEqual([]);
  });

  it('links to me when no one else is named', () => {
    const son = person('kid', 'Son');
    expect(suggestionsFromName(son, [...people, son], 'me')[0]).toMatchObject({ from: 'me', to: 'kid', type: 'parent' });
  });

  it('labels free-form relatives', () => {
    const uncle = person('u', 'Uncle Moshe');
    expect(suggestionsFromName(uncle, [...people, uncle], 'me')[0]).toMatchObject({ type: 'relative', label: 'Uncle' });
  });

  it('does not trust a one-word contact name when others share that first name', () => {
    const many = [person('raz', 'רז'), person('raz2', 'רז לוי'), person('raz3', 'רז כהן')];
    expect(findPersonByName('רז', many, 'x')).toBeNull();
    expect(findPersonByName('רז', [person('raz', 'רז')], 'x')?.id).toBe('raz');
  });

  it('skips ambiguous names', () => {
    const twoSarahs = [...people, person('sarah2', 'Sarah Levi')];
    expect(findPersonByName('Sarah', twoSarahs, 'x')).toBeNull();
    expect(findPersonByName('Sarah Levi', twoSarahs, 'x')?.id).toBe('sarah2');
  });
});
