import { afterEach, describe, expect, it } from 'vitest';
import type { Kinship } from '../graph/kinship';
import type { Gender } from '../model/types';
import { setLanguage } from './i18n';
import { kinshipText } from './kinshipText';

const genders: Record<string, Gender> = { dad: 'male', stepMom: 'female' };
const genderOf = (id: string): Gender => genders[id] ?? 'unknown';
const say = (kinship: Kinship, gender: Gender): string => kinshipText(kinship, gender, genderOf);

afterEach(() => setLanguage('en'));

describe('kinshipText', () => {
  it('speaks English', () => {
    expect(say({ kind: 'named', term: 'auntUncle', greats: 1 }, 'male')).toBe('great-uncle');
    expect(say({ kind: 'cousin', degree: 2, removed: 1 }, 'female')).toBe('second cousin once removed');
    expect(say({ kind: 'named', term: 'coParentInLaw', greats: 0 }, 'male')).toBe('mechutan (child’s father-in-law)');
    expect(say({ kind: 'chain', steps: ['up', 'spouse'], personIds: ['me', 'dad', 'stepMom'] }, 'female')).toBe('father’s wife');
  });

  it('speaks Hebrew', () => {
    setLanguage('he');
    expect(say({ kind: 'cousin', degree: 1, removed: 0 }, 'female')).toBe('בת דודה');
    expect(say({ kind: 'named', term: 'grandparent', greats: 1 }, 'male')).toBe('סבא רבא');
    expect(say({ kind: 'named', term: 'auntUncle', greats: 1 }, 'male')).toBe('דוד של הורה');
    expect(say({ kind: 'chain', steps: ['up', 'spouse'], personIds: ['me', 'dad', 'stepMom'] }, 'female')).toBe('אישה של אבא');
  });
});
