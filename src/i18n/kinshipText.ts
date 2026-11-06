import type { Kinship, KinTerm, Step } from '../graph/kinship';
import type { Gender, Language } from '../model/types';
import { language } from './i18n';

/** Turns an inferred Kinship into words, in English or Hebrew, gendered by the person. */

type Gendered = readonly [male: string, female: string, neutral: string];

function pick(words: Gendered, gender: Gender): string {
  return gender === 'male' ? words[0] : gender === 'female' ? words[1] : words[2];
}

interface KinshipVocabulary {
  terms: Record<KinTerm, Gendered>;
  steps: Record<Step, Gendered>;
  grandparent(gender: Gender, greats: number): string;
  grandchild(gender: Gender, greats: number): string;
  auntUncle(gender: Gender, greats: number): string;
  nieceNephew(gender: Gender, greats: number): string;
  cousin(gender: Gender, degree: number, removed: number): string;
  chain(words: string[]): string;
}

function greatPrefix(greats: number): string {
  if (greats === 0) return '';
  if (greats <= 2) return 'great-'.repeat(greats);
  return `${greats}× great-`;
}

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];

const ENGLISH_TERMS: Record<KinTerm, Gendered> = {
  spouse: ['husband', 'wife', 'spouse'],
  parent: ['father', 'mother', 'parent'],
  child: ['son', 'daughter', 'child'],
  sibling: ['brother', 'sister', 'sibling'],
  grandparent: ['grandfather', 'grandmother', 'grandparent'],
  grandchild: ['grandson', 'granddaughter', 'grandchild'],
  auntUncle: ['uncle', 'aunt', 'aunt / uncle'],
  nieceNephew: ['nephew', 'niece', 'niece / nephew'],
  parentInLaw: ['father-in-law', 'mother-in-law', 'parent-in-law'],
  childInLaw: ['son-in-law', 'daughter-in-law', 'child-in-law'],
  siblingInLaw: ['brother-in-law', 'sister-in-law', 'sibling-in-law'],
  coParentInLaw: ['mechutan (child’s father-in-law)', 'mechuteneste (child’s mother-in-law)', 'mechutan (child’s parent-in-law)'],
};

const ENGLISH: KinshipVocabulary = {
  terms: ENGLISH_TERMS,
  steps: {
    up: ['father', 'mother', 'parent'],
    down: ['son', 'daughter', 'child'],
    sibling: ['brother', 'sister', 'sibling'],
    spouse: ['husband', 'wife', 'spouse'],
  },
  grandparent: (gender, greats) => greatPrefix(greats) + pick(ENGLISH_TERMS.grandparent, gender),
  grandchild: (gender, greats) => greatPrefix(greats) + pick(ENGLISH_TERMS.grandchild, gender),
  auntUncle: (gender, greats) => greatPrefix(greats) + pick(ENGLISH_TERMS.auntUncle, gender),
  nieceNephew: (gender, greats) => greatPrefix(greats) + pick(ENGLISH_TERMS.nieceNephew, gender),
  cousin: (_gender, degree, removed) => {
    const ordinal = ORDINALS[degree - 1] ?? `${degree}th`;
    const removedText = removed === 0 ? '' : removed === 1 ? ' once removed' : removed === 2 ? ' twice removed' : ` ${removed} times removed`;
    return `${ordinal} cousin${removedText}`;
  },
  chain: (words) => words.join('’s '),
};

const HEBREW_TERMS: Record<KinTerm, Gendered> = {
  spouse: ['בעל', 'אישה', 'בן/בת זוג'],
  parent: ['אבא', 'אמא', 'הורה'],
  child: ['בן', 'בת', 'ילד/ה'],
  sibling: ['אח', 'אחות', 'אח/ות'],
  grandparent: ['סבא', 'סבתא', 'סבא/סבתא'],
  grandchild: ['נכד', 'נכדה', 'נכד/ה'],
  auntUncle: ['דוד', 'דודה', 'דוד/ה'],
  nieceNephew: ['אחיין', 'אחיינית', 'אחיין/ית'],
  parentInLaw: ['חם', 'חמות', 'הורה של בן/בת הזוג'],
  childInLaw: ['חתן', 'כלה', 'חתן/כלה'],
  siblingInLaw: ['גיס', 'גיסה', 'גיס/ה'],
  coParentInLaw: ['מחותן', 'מחותנת', 'מחותן/ת'],
};

function hebrewGrandparent(gender: Gender, greats: number): string {
  const base = pick(HEBREW_TERMS.grandparent, gender);
  const suffix = gender === 'female' ? ' רבתא' : ' רבא';
  return base + suffix.repeat(greats);
}

function hebrewGrandchild(gender: Gender, greats: number): string {
  if (greats === 0) return pick(HEBREW_TERMS.grandchild, gender);
  const greatGrandchild = pick(['נין', 'נינה', 'נין/ה'], gender);
  return greats === 1 ? greatGrandchild : `${greatGrandchild} (דור ${greats + 2})`;
}

const HEBREW: KinshipVocabulary = {
  terms: HEBREW_TERMS,
  steps: {
    up: ['אבא', 'אמא', 'הורה'],
    down: ['בן', 'בת', 'ילד/ה'],
    sibling: ['אח', 'אחות', 'אח/ות'],
    spouse: ['בעל', 'אישה', 'בן/בת זוג'],
  },
  grandparent: hebrewGrandparent,
  grandchild: hebrewGrandchild,
  // Parent's uncle = "דוד של הורה"; grandparent's uncle = "דוד של סבא/סבתא".
  auntUncle: (gender, greats) => {
    const base = pick(HEBREW_TERMS.auntUncle, gender);
    if (greats === 0) return base;
    return `${base} של ${greats === 1 ? 'הורה' : hebrewGrandparent('unknown', greats - 2)}`;
  },
  // Sibling's grandchild = "נכד/ה של אח/ות".
  nieceNephew: (gender, greats) => {
    if (greats === 0) return pick(HEBREW_TERMS.nieceNephew, gender);
    return `${hebrewGrandchild(gender, greats - 1)} של אח/ות`;
  },
  cousin: (gender, degree, removed) => {
    const base = pick(['בן דוד', 'בת דודה', 'בן/בת דוד'], gender);
    const degreeText = degree === 1 ? '' : ` מדרגה ${degree}`;
    const removedText = removed === 0 ? '' : removed === 1 ? ' (בהפרש דור)' : ` (בהפרש ${removed} דורות)`;
    return base + degreeText + removedText;
  },
  chain: (words) => [...words].reverse().join(' של '),
};

const VOCABULARIES: Record<Language, KinshipVocabulary> = { en: ENGLISH, he: HEBREW };

/**
 * @param gender gender of the person the kinship describes
 * @param genderOf looks up the gender of people along a literal chain
 */
export function kinshipText(kinship: Kinship, gender: Gender, genderOf: (personId: string) => Gender): string {
  const vocabulary = VOCABULARIES[language()];
  switch (kinship.kind) {
    case 'self':
      return '';
    case 'cousin':
      return vocabulary.cousin(gender, kinship.degree, kinship.removed);
    case 'chain':
      return vocabulary.chain(
        kinship.steps.map((step, i) => pick(vocabulary.steps[step], genderOf(kinship.personIds[i + 1] as string))),
      );
    case 'named':
      switch (kinship.term) {
        case 'grandparent':
          return vocabulary.grandparent(gender, kinship.greats);
        case 'grandchild':
          return vocabulary.grandchild(gender, kinship.greats);
        case 'auntUncle':
          return vocabulary.auntUncle(gender, kinship.greats);
        case 'nieceNephew':
          return vocabulary.nieceNephew(gender, kinship.greats);
        default:
          return pick(vocabulary.terms[kinship.term], gender);
      }
  }
}
