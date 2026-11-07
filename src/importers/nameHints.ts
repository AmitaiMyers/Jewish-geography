import { newId } from '../model/assert';
import { normalizeName } from '../model/identity';
import type { Gender, Person, RelationType, Suggestion, UnresolvedEndpoint } from '../model/types';
import type { RawContact } from './rawContact';

/**
 * Turns hints hidden in contact names into suggested links, e.g.
 *   "Mom"                  → parent of me
 *   "Uncle Moshe"          → relative of me, labelled "Uncle"
 *   "Avi (cousin)"         → relative of me, labelled "Cousin"
 *   "Rivka (Sarah's mom)"  → parent of Sarah
 *   "אבא של שרה"            → parent of Sarah
 *   "אמא שאול"              → parent of Shaul (a parent word + a name is someone else's parent)
 *   "לילך בת דודה"           → my cousin (a kinship word after a name)
 *   "שכנה של קרן"            → Keren's neighbour;  "נעמה של ניצן" → Nitzan's partner
 * Nothing is linked automatically: the user accepts or dismisses each suggestion.
 */

type HintKind = 'parentOfAnchor' | 'childOfAnchor' | 'spouse' | 'sibling' | 'friend' | 'neighbor' | 'work' | 'relative';

/** Most candidates shown on a card when a name is ambiguous. */
const MAX_CANDIDATES = 12;
/** Place names that contain a kinship word ("כפר סבא" is a city, not a grandfather). */
const PLACE_PHRASES = [/כפר\s+סבא/g];

interface VocabularyEntry {
  kind: HintKind;
  gender: Gender;
}

// Ambiguous words are deliberately left out: Hebrew "דוד" is also the name David,
// and "בן"/"בן דוד" are common surname parts (Ben-David).
const VOCABULARY: Record<string, VocabularyEntry> = {
  dad: { kind: 'parentOfAnchor', gender: 'male' },
  father: { kind: 'parentOfAnchor', gender: 'male' },
  abba: { kind: 'parentOfAnchor', gender: 'male' },
  aba: { kind: 'parentOfAnchor', gender: 'male' },
  tatty: { kind: 'parentOfAnchor', gender: 'male' },
  'אבא': { kind: 'parentOfAnchor', gender: 'male' },
  mom: { kind: 'parentOfAnchor', gender: 'female' },
  mum: { kind: 'parentOfAnchor', gender: 'female' },
  mother: { kind: 'parentOfAnchor', gender: 'female' },
  mommy: { kind: 'parentOfAnchor', gender: 'female' },
  ima: { kind: 'parentOfAnchor', gender: 'female' },
  imma: { kind: 'parentOfAnchor', gender: 'female' },
  eema: { kind: 'parentOfAnchor', gender: 'female' },
  'אמא': { kind: 'parentOfAnchor', gender: 'female' },
  'מאמא': { kind: 'parentOfAnchor', gender: 'female' },
  mama: { kind: 'parentOfAnchor', gender: 'female' },
  son: { kind: 'childOfAnchor', gender: 'male' },
  daughter: { kind: 'childOfAnchor', gender: 'female' },
  wife: { kind: 'spouse', gender: 'female' },
  husband: { kind: 'spouse', gender: 'male' },
  'אשתי': { kind: 'spouse', gender: 'female' },
  'אישה': { kind: 'spouse', gender: 'female' },
  'בעלי': { kind: 'spouse', gender: 'male' },
  brother: { kind: 'sibling', gender: 'male' },
  bro: { kind: 'sibling', gender: 'male' },
  'אח': { kind: 'sibling', gender: 'male' },
  'אחי': { kind: 'sibling', gender: 'male' },
  sister: { kind: 'sibling', gender: 'female' },
  sis: { kind: 'sibling', gender: 'female' },
  'אחות': { kind: 'sibling', gender: 'female' },
  'אחותי': { kind: 'sibling', gender: 'female' },
  friend: { kind: 'friend', gender: 'unknown' },
  neighbor: { kind: 'neighbor', gender: 'unknown' },
  neighbour: { kind: 'neighbor', gender: 'unknown' },
  'שכן': { kind: 'neighbor', gender: 'male' },
  'שכנה': { kind: 'neighbor', gender: 'female' },
  secretary: { kind: 'work', gender: 'unknown' },
  colleague: { kind: 'work', gender: 'unknown' },
  'מזכיר': { kind: 'work', gender: 'male' },
  'מזכירה': { kind: 'work', gender: 'female' },
  'חבר': { kind: 'friend', gender: 'male' },
  'חברה': { kind: 'friend', gender: 'female' },
  grandma: { kind: 'relative', gender: 'female' },
  grandmother: { kind: 'relative', gender: 'female' },
  granny: { kind: 'relative', gender: 'female' },
  bubby: { kind: 'relative', gender: 'female' },
  bubbie: { kind: 'relative', gender: 'female' },
  bubbe: { kind: 'relative', gender: 'female' },
  savta: { kind: 'relative', gender: 'female' },
  'סבתא': { kind: 'relative', gender: 'female' },
  grandpa: { kind: 'relative', gender: 'male' },
  grandfather: { kind: 'relative', gender: 'male' },
  zaidy: { kind: 'relative', gender: 'male' },
  zaidie: { kind: 'relative', gender: 'male' },
  zayde: { kind: 'relative', gender: 'male' },
  zeidy: { kind: 'relative', gender: 'male' },
  saba: { kind: 'relative', gender: 'male' },
  'סבא': { kind: 'relative', gender: 'male' },
  uncle: { kind: 'relative', gender: 'male' },
  dod: { kind: 'relative', gender: 'male' },
  aunt: { kind: 'relative', gender: 'female' },
  auntie: { kind: 'relative', gender: 'female' },
  aunty: { kind: 'relative', gender: 'female' },
  doda: { kind: 'relative', gender: 'female' },
  'דודה': { kind: 'relative', gender: 'female' },
  cousin: { kind: 'relative', gender: 'unknown' },
  'בת דודה': { kind: 'relative', gender: 'female' },
  nephew: { kind: 'relative', gender: 'male' },
  'אחיין': { kind: 'relative', gender: 'male' },
  niece: { kind: 'relative', gender: 'female' },
  'אחיינית': { kind: 'relative', gender: 'female' },
  'brother-in-law': { kind: 'relative', gender: 'male' },
  'גיס': { kind: 'relative', gender: 'male' },
  'sister-in-law': { kind: 'relative', gender: 'female' },
  'גיסה': { kind: 'relative', gender: 'female' },
};

export interface NameHint {
  /** Canonical vocabulary word, e.g. "uncle". */
  word: string;
  entry: VocabularyEntry;
  /** Name of the person the word is relative to; null means "me". */
  anchorName: string | null;
}

function lookup(phrase: string): Found | null {
  const word = normalizeName(phrase);
  const entry = VOCABULARY[word];
  return entry === undefined ? null : { word, entry };
}

type Found = { word: string; entry: VocabularyEntry };

/** "Sarah's dad" → anchor "Sarah", word "dad". */
const POSSESSIVE = /([\p{L}][\p{L}\s.'-]*?)['’]s\s+([\p{L}-]+)/u;
/** "dad of Sarah" / "משה אבא של שרה" → text before and after the connector. */
const OF_PHRASE = /^(.+?)\s+(?:of|של)\s+(.+)$/iu;

/** Text inside parentheses or after a dash: "Avi (cousin)" / "Avi - cousin". */
function annotations(name: string): string[] {
  const inParens = [...name.matchAll(/\(([^)]+)\)/g)].map((m) => m[1] as string);
  const afterDash = name.split(/\s[-–|]\s/).slice(1);
  return [...inParens, ...afterDash].map((part) => part.trim()).filter((part) => part.length > 0);
}

function withoutParentheses(text: string): string {
  return text.replace(/\(.*?\)/g, ' ').trim();
}

/** Emoji and punctuation around a referenced name ("רז😉") would stop it matching a contact. */
function cleanAnchor(text: string): string {
  return text.replace(/[^\p{L}\p{N}\s'"׳״-]/gu, '').replace(/\s+/g, ' ').trim();
}

/** Tries the first two words, then the first word ("בת דודה רחל", "Uncle Moshe"); also returns the words after it. */
function leadingWord(text: string): { found: Found; rest: string } | null {
  const words = text.split(/\s+/);
  for (const size of [2, 1]) {
    const found = lookup(words.slice(0, size).join(' '));
    if (found !== null) {
      return { found, rest: words.slice(size).join(' ') };
    }
  }
  return null;
}

/** Tries the last two words, then the last word ("משה אבא" → "אבא"). */
function trailingWord(text: string): Found | null {
  const words = text.split(/\s+/);
  return lookup(words.slice(-2).join(' ')) ?? lookup(words[words.length - 1] ?? '');
}

/** A hint relative to someone named in the text, e.g. "Sarah's dad" or "אבא של שרה". */
function hintAboutSomeoneElse(segment: string): NameHint | null {
  const possessive = POSSESSIVE.exec(segment);
  if (possessive !== null) {
    const found = lookup(possessive[2] as string);
    if (found !== null) {
      return { ...found, anchorName: cleanAnchor(possessive[1] as string) };
    }
  }
  const ofPhrase = OF_PHRASE.exec(segment);
  if (ofPhrase !== null) {
    const before = (ofPhrase[1] as string).trim();
    const found = trailingWord(before);
    if (found !== null) {
      return { ...found, anchorName: cleanAnchor(ofPhrase[2] as string) };
    }
    // "נעמה של ניצן" — just a name, then "של", then a name: a couple. (Hebrew only: "Bank of America" is not.)
    if (/\sשל\s/.test(segment) && /^[\p{L}'׳"-]+(\s[\p{L}'׳"-]+)?$/u.test(before)) {
      return { word: 'של', entry: COUPLE, anchorName: cleanAnchor(ofPhrase[2] as string) };
    }
  }
  return null;
}

const COUPLE: VocabularyEntry = { kind: 'spouse', gender: 'unknown' };

export function parseNameHints(name: string): NameHint[] {
  for (const segment of [...annotations(name), withoutParentheses(name)]) {
    const hint = hintAboutSomeoneElse(segment);
    if (hint !== null) {
      return [hint];
    }
  }
  for (const annotation of annotations(name)) {
    const found = lookup(annotation);
    if (found !== null) {
      return [{ ...found, anchorName: null }];
    }
  }
  const plain = PLACE_PHRASES.reduce((text, place) => text.replace(place, ' '), withoutParentheses(name)).trim();
  const leading = leadingWord(plain);
  if (leading === null) {
    // "לילך בת דודה": a name followed by a kinship word is that relation to me.
    const words = plain.split(/\s+/);
    const trailing = words.length >= 2 ? trailingWord(plain) : null;
    const isWholeName = trailing !== null && normalizeName(plain) === trailing.word;
    return trailing === null || isWholeName ? [] : [{ ...trailing, anchorName: null }];
  }
  // "אמא שאול" / "Mom Sarah" is someone else's parent (your own is just "אמא" / "Mom"),
  // whereas "דודה רחל" / "Uncle Moshe" is your relative called Rachel / Moshe.
  const rest = cleanAnchor(leading.rest);
  const isSomeoneElsesParent = leading.found.entry.kind === 'parentOfAnchor' && rest !== '';
  return [{ ...leading.found, anchorName: isSomeoneElsesParent ? rest : null }];
}

/**
 * Finds the one person a short name refers to; ambiguous or unknown names give null.
 * A one-word name ("רז") is only trusted when nobody else shares that first name —
 * with fifteen people called Raz, a contact named just "רז" is not necessarily the one meant.
 */
export function findPersonByName(name: string, people: readonly Person[], excludeId: string): Person | null {
  const wanted = normalizeName(name);
  const candidates = people.filter((person) => person.id !== excludeId);
  const exact = candidates.filter((person) => normalizeName(person.name) === wanted);
  const byFirstName = candidates.filter((person) => normalizeName(person.name).split(' ')[0] === wanted);
  const isSingleWord = !wanted.includes(' ');
  if (exact.length === 1 && (!isSingleWord || byFirstName.length === 1)) {
    return exact[0] as Person;
  }
  if (exact.length > 1) {
    return null;
  }
  return byFirstName.length === 1 ? (byFirstName[0] as Person) : null;
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** Everyone a short name could mean: exact full-name matches and first-name matches, most likely first. */
export function findCandidates(name: string, people: readonly Person[], excludeId: string): Person[] {
  const wanted = normalizeName(name);
  const others = people.filter((person) => person.id !== excludeId);
  const exact = others.filter((person) => normalizeName(person.name) === wanted);
  const byFirstName = others.filter((person) => normalizeName(person.name).split(' ')[0] === wanted);
  // "נועה (צ׳יקה)": a nickname in parentheses is a name too.
  const byNickname = others.filter((person) => [...person.name.matchAll(/\(([^)]+)\)/g)].some((m) => normalizeName(m[1] as string) === wanted));
  return [...new Set([...exact, ...byNickname, ...byFirstName])].slice(0, MAX_CANDIDATES);
}

function linkFor(kind: HintKind, subjectId: string, anchorId: string): { from: string; to: string; type: RelationType } {
  switch (kind) {
    case 'parentOfAnchor':
      return { from: subjectId, to: anchorId, type: 'parent' };
    case 'childOfAnchor':
      return { from: anchorId, to: subjectId, type: 'parent' };
    case 'spouse':
    case 'sibling':
    case 'friend':
    case 'neighbor':
    case 'work':
    case 'relative':
      return { from: subjectId, to: anchorId, type: kind };
  }
}

/**
 * Only parent/child hints naming a single first name may add a missing person:
 * "אמא של יושו" clearly means a child called Yoshu; "אמא אפיקים בנגב" is not a name.
 */
function canCreateAnchor(kind: HintKind, name: string): boolean {
  return (kind === 'parentOfAnchor' || kind === 'childOfAnchor') && !/\s/.test(name.trim());
}

export function suggestionsFromName(subject: Person, people: readonly Person[], meId: string): Suggestion[] {
  if (subject.id === meId) {
    return [];
  }
  return parseNameHints(subject.name).flatMap((hint): Suggestion[] => {
    const base = {
      id: newId(),
      label: hint.entry.kind === 'relative' ? capitalize(hint.word) : '',
      subjectId: subject.id,
      genderHint: hint.entry.gender,
      evidence: subject.name,
    };
    if (hint.anchorName === null) {
      return [{ ...base, ...linkFor(hint.entry.kind, subject.id, meId), unresolved: null }];
    }
    const anchor = findPersonByName(hint.anchorName, people, subject.id);
    if (anchor !== null) {
      return [{ ...base, ...linkFor(hint.entry.kind, subject.id, anchor.id), unresolved: null }];
    }
    const candidates = findCandidates(hint.anchorName, people, subject.id);
    const canCreate = canCreateAnchor(hint.entry.kind, hint.anchorName);
    if (candidates.length === 0 && !canCreate) {
      return [];
    }
    const link = linkFor(hint.entry.kind, subject.id, '');
    const unresolved: UnresolvedEndpoint = {
      side: link.from === '' ? 'from' : 'to',
      name: hint.anchorName,
      candidateIds: candidates.map((person) => person.id),
      canCreate,
    };
    return [{ ...base, ...link, unresolved }];
  });
}

// ---------- one contact, two people ----------

export interface JointContact {
  first: RawContact;
  second: RawContact;
  /** The shared relation as written, e.g. "סבא וסבתא". */
  role: string;
}

const JOINT_NAME = /^(\S+)\s+ו(\S+)\s+(\S+)\s+ו(\S+)$/u;

/**
 * "פני וגרי סבא וסבתא" → Penny and Gary, my grandparents (and a couple).
 * Deliberately strict — both trailing words must be kinship words — so surnames
 * starting with ו ("יואב וולף") are never split.
 */
export function splitJointContact(contact: RawContact): JointContact | null {
  const match = JOINT_NAME.exec(contact.name.trim());
  if (match === null || lookup(match[3] as string) === null || lookup(match[4] as string) === null) {
    return null;
  }
  return {
    first: { name: match[1] as string, phones: contact.phones, emails: contact.emails },
    second: { name: match[2] as string, phones: [], emails: [] },
    role: `${match[3] as string} ו${match[4] as string}`,
  };
}

/** Suggestions for a split contact: each is my relative ("סבא וסבתא"), and they are a couple. */
export function jointSuggestions(first: Person, second: Person, role: string, evidence: string, meId: string): Suggestion[] {
  const make = (from: string, to: string, type: RelationType, label: string, subjectId: string): Suggestion => ({
    id: newId(),
    from,
    to,
    type,
    label,
    subjectId,
    genderHint: 'unknown',
    evidence,
    unresolved: null,
  });
  return [
    make(first.id, meId, 'relative', role, first.id),
    make(second.id, meId, 'relative', role, second.id),
    make(first.id, second.id, 'spouse', '', first.id),
  ];
}
