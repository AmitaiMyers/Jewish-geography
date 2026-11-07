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

type HintKind =
  | 'parentOfAnchor'
  | 'childOfAnchor'
  | 'spouse'
  | 'sibling'
  | 'friend'
  | 'neighbor'
  | 'work'
  | 'army'
  | 'school'
  | 'relative'
  | 'knows'
  | 'custom';

/** Most candidates shown on a card when a name is ambiguous. */
const MAX_CANDIDATES = 12;
/** Place names that contain a kinship word ("כפר סבא" is a city, not a grandfather). */
const PLACE_PHRASES = [/כפר\s+סבא/g];

interface VocabularyEntry {
  kind: HintKind;
  gender: Gender;
}

/**
 * Roles someone has toward me, recognised anywhere in the name:
 * "המפקד נדב", "גל ברזני מפקד", "סיון מורה ללשון", "רוני הבוס", "ספיר מאמנת".
 */
const ROLE_VOCABULARY: Record<string, VocabularyEntry> = {
  'המפקד': { kind: 'army', gender: 'male' },
  'מפקד': { kind: 'army', gender: 'male' },
  'המפקדת': { kind: 'army', gender: 'female' },
  'מפקדת': { kind: 'army', gender: 'female' },
  'סגן': { kind: 'army', gender: 'male' },
  commander: { kind: 'army', gender: 'unknown' },
  'מורה': { kind: 'school', gender: 'unknown' },
  'המורה': { kind: 'school', gender: 'unknown' },
  teacher: { kind: 'school', gender: 'unknown' },
  'בוס': { kind: 'work', gender: 'unknown' },
  'הבוס': { kind: 'work', gender: 'unknown' },
  'מנהל': { kind: 'work', gender: 'male' },
  'מנהלת': { kind: 'work', gender: 'female' },
  boss: { kind: 'work', gender: 'unknown' },
  manager: { kind: 'work', gender: 'unknown' },
  'מאמן': { kind: 'custom', gender: 'male' },
  'מאמנת': { kind: 'custom', gender: 'female' },
  coach: { kind: 'custom', gender: 'unknown' },
};

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
  'הורים': { kind: 'parentOfAnchor', gender: 'unknown' },
  'ההורים': { kind: 'parentOfAnchor', gender: 'unknown' },
  'אחותיי': { kind: 'sibling', gender: 'female' },
  'בתדודה': { kind: 'relative', gender: 'female' },
  'בןדוד': { kind: 'relative', gender: 'male' },
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
  ...ROLE_VOCABULARY,
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

/**
 * Words that are only safe right before "של": alone, "בן"/"בת" are surname parts (Ben-David) and
 * "בן דוד" is a surname, but "ענת בת של ורדה" and "ליאם בן דוד של שקד" are unambiguous.
 */
const OF_ONLY_VOCABULARY: Record<string, VocabularyEntry> = {
  'בן': { kind: 'childOfAnchor', gender: 'male' },
  'הבן': { kind: 'childOfAnchor', gender: 'male' },
  'בת': { kind: 'childOfAnchor', gender: 'female' },
  'הבת': { kind: 'childOfAnchor', gender: 'female' },
  'בעלה': { kind: 'spouse', gender: 'male' },
  'אשתו': { kind: 'spouse', gender: 'female' },
  'אישתו': { kind: 'spouse', gender: 'female' },
  'בן זוג': { kind: 'spouse', gender: 'male' },
  'בת זוג': { kind: 'spouse', gender: 'female' },
  'בן הזוג': { kind: 'spouse', gender: 'male' },
  'בת הזוג': { kind: 'spouse', gender: 'female' },
  'בן דוד': { kind: 'relative', gender: 'male' },
  'בת דוד': { kind: 'relative', gender: 'female' },
  'חייל': { kind: 'army', gender: 'male' },
  'חיילת': { kind: 'army', gender: 'female' },
  'פיזיו': { kind: 'work', gender: 'unknown' },
  'שותף': { kind: 'custom', gender: 'male' },
  'שותפה': { kind: 'custom', gender: 'female' },
};

function lookupBeforeOf(phrase: string): Found | null {
  const word = normalizeName(phrase);
  const entry = OF_ONLY_VOCABULARY[word];
  return lookup(phrase) ?? (entry === undefined ? null : { word, entry });
}

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
function trailingWord(text: string, find: (phrase: string) => Found | null = lookup): Found | null {
  const words = text.split(/\s+/);
  return find(words.slice(-2).join(' ')) ?? find(words[words.length - 1] ?? '');
}

/** "שירה בת דודה עדי": a family word between two names is the first person's relation to the second. */
function kinshipInTheMiddle(words: readonly string[]): NameHint | null {
  for (let i = 1; i < words.length - 1; i++) {
    for (const size of [2, 1]) {
      const found = lookup(words.slice(i, i + size).join(' '));
      const after = cleanAnchor(words.slice(i + size).join(' '));
      if (found !== null && FAMILY_KINDS.has(found.entry.kind) && after !== '') {
        return { ...found, anchorName: after };
      }
    }
  }
  return null;
}

const FAMILY_KINDS = new Set<HintKind>(['parentOfAnchor', 'childOfAnchor', 'spouse', 'sibling', 'relative']);

/** "(דרך עדן עמר)", "(מנקה דרך אוסי)": met through that person — the heart of Jewish geography. */
function metThrough(annotation: string): NameHint | null {
  const match = /(?:^|\s)דרך\s+(.+)$/u.exec(annotation);
  return match === null ? null : { word: 'דרך', entry: { kind: 'knows', gender: 'unknown' }, anchorName: cleanAnchor(match[1] as string) };
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
    const found = trailingWord(before, lookupBeforeOf);
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
    const through = metThrough(annotation);
    if (through !== null) {
      return [through];
    }
  }
  // Emoji glued to words ("אחותיי❤️") would hide them.
  const plain = cleanAnchor(PLACE_PHRASES.reduce((text, place) => text.replace(place, ' '), withoutParentheses(name)));
  const leading = leadingWord(plain);
  if (leading === null) {
    // "לילך בת דודה": a name followed by a kinship word is that relation to me.
    const words = plain.split(/\s+/);
    const trailing = words.length >= 2 ? trailingWord(plain) : null;
    const isWholeName = trailing !== null && normalizeName(plain) === trailing.word;
    const middle = kinshipInTheMiddle(words);
    if (middle !== null) {
      return [middle];
    }
    if (trailing !== null && !isWholeName) {
      return [{ ...trailing, anchorName: null }];
    }
    // "סיון מורה ללשון": a role word anywhere in the name is that role toward me.
    const role = words.map((word) => normalizeName(word)).find((word) => word in ROLE_VOCABULARY);
    return role === undefined ? [] : [{ word: role, entry: ROLE_VOCABULARY[role] as VocabularyEntry, anchorName: null }];
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
    case 'army':
    case 'school':
    case 'relative':
    case 'knows':
    case 'custom':
      return { from: subjectId, to: anchorId, type: kind };
  }
}

/**
 * Only parent/child hints naming a single first name may add a missing person:
 * "אמא של יושו" clearly means a child called Yoshu; "אמא אפיקים בנגב" is not a name.
 */
function canCreateAnchor(kind: HintKind, name: string): boolean {
  return (kind === 'parentOfAnchor' || kind === 'childOfAnchor') && !/[\s\d]/.test(name.trim());
}

/** Last words of my names ("Amitai Myers", "אמיתי מיירס" → myers, מיירס): my family's surnames. */
export function surnamesOf(person: Person): Set<string> {
  return new Set(
    [person.name, ...person.otherNames]
      .map((name) => normalizeName(withoutParentheses(name)).split(' '))
      .filter((words) => words.length >= 2)
      .map((words) => words[words.length - 1] as string),
  );
}

function isOneOfMyNames(name: string, me: Person): boolean {
  const wanted = normalizeName(name);
  return [me.name, ...me.otherNames].some((mine) => normalizeName(mine) === wanted);
}

/** "יוני מיירס" shares my surname: family, but the name does not say how — the card will ask. */
function familyBySurname(subject: Person, me: Person): Suggestion | null {
  const words = normalizeName(withoutParentheses(subject.name)).split(' ');
  const surname = words[words.length - 1] as string;
  if (words.length < 2 || !surnamesOf(me).has(surname) || isOneOfMyNames(subject.name, me)) {
    return null;
  }
  const isHebrew = /[\u0590-\u05ff]/.test(surname);
  return {
    id: newId(),
    from: subject.id,
    to: me.id,
    type: 'relative',
    label: isHebrew ? `משפחת ${surname}` : `${capitalize(surname)} family`,
    subjectId: subject.id,
    genderHint: 'unknown',
    evidence: subject.name,
    unresolved: null,
    askKind: true,
  };
}

export function suggestionsFromName(subject: Person, people: readonly Person[], meId: string): Suggestion[] {
  if (subject.id === meId) {
    return [];
  }
  const hints = parseNameHints(subject.name);
  if (hints.length === 0) {
    const me = people.find((person) => person.id === meId);
    const byFamily = me === undefined ? null : familyBySurname(subject, me);
    return byFamily === null ? [] : [byFamily];
  }
  return hints.flatMap((hint): Suggestion[] => {
    const base = {
      id: newId(),
      label: hint.entry.kind === 'relative' || hint.entry.kind === 'custom' ? capitalize(hint.word) : '',
      subjectId: subject.id,
      genderHint: hint.entry.gender,
      evidence: subject.name,
      askKind: false,
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
  /** The shared relation to me as written ("סבא וסבתא"), or null when the name only says they are a couple. */
  role: string | null;
}

const JOINT_KINSHIP = /^(\S+)\s+ו(\S+)\s+(\S+)\s+ו(\S+)$/u;

/** What the rest of the address book tells us about words, for deciding whether "X וY" is two people. */
export interface SplitEvidence {
  /** How many contacts start with each normalised word: those words are first names. */
  firstNames: ReadonlyMap<string, number>;
  /** My family's surnames (from all my names). */
  familySurnames: ReadonlySet<string>;
}

/**
 * One contact, two people:
 *   "פני וגרי סבא וסבתא" → Penny and Gary, my grandparents (and a couple);
 *   "מיירס פני וג'רי" → a couple of my family; "דני ורונית כהן" → a couple, when both are known first names.
 * Many surnames start with ו (וייס, וולף, וינשטיין), so "X וY" is only split when Y is the first name
 * of another contact as well as X, or when the rest of the name is my own family's surname.
 */
export function splitJointContact(contact: RawContact, evidence: SplitEvidence): JointContact | null {
  const name = contact.name.trim();
  const kinship = JOINT_KINSHIP.exec(name);
  if (kinship !== null && lookup(kinship[3] as string) !== null && lookup(kinship[4] as string) !== null) {
    return {
      first: { name: kinship[1] as string, phones: contact.phones, emails: contact.emails },
      second: { name: kinship[2] as string, phones: [], emails: [] },
      role: `${kinship[3] as string} ו${kinship[4] as string}`,
    };
  }

  const words = name.split(/\s+/);
  const joinIndexes = words.map((word, i) => (i > 0 && /^ו[\p{L}]/u.test(word) ? i : -1)).filter((i) => i !== -1);
  if (words.length < 2 || words.length > 4 || joinIndexes.length !== 1 || /\d/.test(name) || parseNameHints(name).length > 0) {
    return null;
  }
  const join = joinIndexes[0] as number;
  const firstName = words[join - 1] as string;
  const secondName = (words[join] as string).slice(1);
  const shared = words.filter((_, i) => i !== join && i !== join - 1).join(' ');
  const isKnownFirstName = (word: string): boolean => (evidence.firstNames.get(normalizeName(word)) ?? 0) > 0;
  const bothFirstNames = isKnownFirstName(firstName) && isKnownFirstName(secondName);
  const isMyFamily = shared !== '' && evidence.familySurnames.has(normalizeName(shared));
  if (!bothFirstNames && !isMyFamily) {
    return null;
  }
  const full = (given: string): string => (shared === '' ? given : `${given} ${shared}`);
  return {
    first: { name: full(firstName), phones: contact.phones, emails: contact.emails },
    second: { name: full(secondName), phones: [], emails: [] },
    role: null,
  };
}

/** Evidence for splitJointContact from every name in the address book and my own names. */
export function splitEvidence(names: readonly string[], me: Person): SplitEvidence {
  const firstNames = new Map<string, number>();
  for (const name of names) {
    const words = normalizeName(name).split(' ');
    if (words.length > 1) {
      firstNames.set(words[0] as string, (firstNames.get(words[0] as string) ?? 0) + 1);
    }
  }
  return { firstNames, familySurnames: surnamesOf(me) };
}

/** Suggestions for a split contact: a couple, and (when the name says so) both my relatives. */
export function jointSuggestions(first: Person, second: Person, role: string | null, evidence: string, meId: string): Suggestion[] {
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
    askKind: false,
  });
  return [
    ...(role === null ? [] : [make(first.id, meId, 'relative', role, first.id), make(second.id, meId, 'relative', role, second.id)]),
    make(first.id, second.id, 'spouse', '', first.id),
  ];
}

// ---------- pets and co-parents ----------

const PET_SIGN = /[\u{1F436}\u{1F9AE}\u{1F415}\u{1F429}\u{1F43E}\u{1F408}\u{1F431}]|כלב|לברדור|גולדן|רטריבר|פודל/u;

/** Who a parent hint points at, as a comparable first name: "אמא של מנטה 🐶" → "מנטה". */
function parentTargetKey(name: string): string | null {
  const [hint] = parseNameHints(name);
  if (hint === undefined || hint.entry.kind !== 'parentOfAnchor' || hint.anchorName === null || hint.anchorName === '') {
    return null;
  }
  return normalizeName(hint.anchorName).split(' ')[0] as string;
}

/** Names of pets, from contacts like "שיר אמא של מנטה 🐶" or "דניאל אבא של שוקו לברדור". */
export function petNames(names: readonly string[]): Set<string> {
  return new Set(names.filter((name) => PET_SIGN.test(name)).flatMap((name) => parentTargetKey(name) ?? []));
}

/** "טל אמא של סנואו" is a dog owner when Snow is a pet in any contact (or this one has a pet sign). */
export function isPetOwner(name: string, pets: ReadonlySet<string>): boolean {
  const target = parentTargetKey(name);
  return target !== null && (PET_SIGN.test(name) || pets.has(target));
}

/**
 * Cross-contact clean-up of parent hints:
 *  - a pet owner gets no "parent of …" suggestion (no dog becomes a person) — they go to the 🐶 group;
 *  - two contacts who are parents of the same child or pet ("רותם אבא של סנואו", "טל אמא של סנואו")
 *    are suggested as a couple.
 */
export function refineParentHints(suggestions: readonly Suggestion[], people: ReadonlyMap<string, Person>, pets: ReadonlySet<string>): Suggestion[] {
  const parentHints = suggestions.filter((x) => x.type === 'parent' && x.from === x.subjectId);
  const byTarget = new Map<string, Suggestion[]>();
  for (const hint of parentHints) {
    const target =
      hint.unresolved !== null ? normalizeName(hint.unresolved.name).split(' ')[0] : `id:${hint.to}`;
    byTarget.set(target as string, [...(byTarget.get(target as string) ?? []), hint]);
  }
  const couples: Suggestion[] = [];
  for (const hints of byTarget.values()) {
    const subjects = [...new Set(hints.map((hint) => hint.subjectId))];
    if (subjects.length === 2) {
      const [first, second] = subjects as [string, string];
      couples.push({
        id: newId(),
        from: first,
        to: second,
        type: 'spouse',
        label: '',
        subjectId: first,
        genderHint: 'unknown',
        evidence: hints.map((hint) => hint.evidence).join(' + '),
        unresolved: null,
        askKind: false,
      });
    }
  }
  const kept = suggestions.filter((x) => !(parentHints.includes(x) && isPetOwner((people.get(x.subjectId) as Person).name, pets)));
  return [...kept, ...couples];
}
