import { normalizeName } from '../model/identity';

/**
 * Finds "where I know them from" labels inside contact names and recognises service contacts.
 *
 * People write context into names: "תומר מדמ"ח", "Liraz Axioma", "דניאל מילואים", "Tal תגלית".
 * A word is a label when it is used by several contacts but is neither a first name
 * (first names come first in most names they appear in) nor a common surname.
 */

export const MIN_LABEL_CONTACTS = 5;
/** Above this share of first-position uses, a word is treated as a first name ("גל", "יובל", "ניב"). */
const FIRST_NAME_SHARE = 0.3;
/** Two words that appear together this often form one label ("באר שבע", "בן גוריון"). */
const PHRASE_SHARE = 0.7;

/** Role/context words people put first ("המפקד נדב", "מזכירות מדמ"ח"): labels in any position. */
const ROLE_WORDS = new Set([
  'המפקד', 'מפקד', 'מפקדת', 'קצין', 'קצינה', 'מזכירות', 'מזכירה', 'מורה', 'מדריך', 'מדריכה', 'רופא', 'רופאה',
  'מאמן', 'מאמנת', 'דירה', 'שכן', 'שכנה', 'מילואים', 'צוות', 'teacher', 'coach', 'doctor',
]);

/** Words that mark a business / service rather than someone you know. */
const SERVICE_WORDS = new Set([
  'שליח', 'שליחויות', 'משלוחים', 'מונית', 'מוניות', 'הסעה', 'הסעות', 'נהג', 'טרמפ', 'פקס', 'מרפאה', 'מרפאת',
  'רשות', 'ביטוח', 'הובלה', 'הובלות', 'צלם', 'סטודיו', 'אינסטלטור', 'חשמלאי', 'מוסך', 'טכנאי', 'מנעולן',
  'שיפוצים', 'קבלן', 'מוקד', 'בנק', 'סניף', 'פיצה', 'פיצריה', 'מספרה', 'ספר', 'וטרינר', 'שמאי', 'מתקין',
  'taxi', 'delivery', 'pizza', 'clinic', 'insurance', 'studio', 'plumber', 'electrician', 'garage', 'support', 'fax',
]);

/** Common surnames and filler words that repeat across names without being a shared context. */
const NOT_LABELS = new Set([
  'של', 'בן', 'בת', 'ה', 'ו', 'אמא', 'אבא', 'mom', 'dad', 'the', 'and',
  'כהן', 'לוי', 'מזרחי', 'פרץ', 'ביטון', 'דהן', 'אברהם', 'פרידמן', 'אגבריה', 'מלכה', 'אזולאי', 'כץ', 'יוסף',
  'דוד', 'עמר', 'אוחיון', 'חדד', 'גבאי', 'שפירא', 'קליין', 'מימון', 'שלום', 'וקנין', 'גולדברג', 'רוזנברג',
  'אשכנזי', 'חזן', 'אוחנה', 'סויסה', 'יעקב', 'נחום', 'בכר', 'ששון', 'גרינברג', 'הרוש', 'לנדאו', 'ברגר',
  'שטרן', 'וייס', 'זילברמן', 'גולן', 'רביבו', 'אסולין', 'אלקיים', 'אדלר', 'שמעוני', 'נגר', 'יהודה', 'ישראל',
  'מאיר', 'אליהו', 'משה', 'שמואל', 'אהרון', 'יצחק', 'רוזן', 'לוין', 'ליבוביץ', 'שושן', 'עזרא', 'אלמוג',
  'cohen', 'levi', 'levy', 'ben', 'friedman', 'katz', 'mizrahi', 'peretz', 'shapira', 'klein', 'weiss',
]);

/** Splits a name into comparable words: lowercased, without niqqud, quotes or punctuation (מדמ"ח → מדמח). */
export function nameWords(name: string): string[] {
  return normalizeName(name)
    .replace(/["'׳״`´]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 2 && !/^\d{1,2}$/.test(word))
    .map((word) => SPELLING_VARIANTS[word] ?? word);
}

/** Common alternative spellings that should count as one word ("כח אדם" = "כוח אדם"). */
const SPELLING_VARIANTS: Record<string, string> = { 'כח': 'כוח' };

export function isServiceName(name: string): boolean {
  return nameWords(name).some((word) => SERVICE_WORDS.has(word));
}

export interface Label {
  /** Comparable words, one or two ("מדמח", "באר שבע"). */
  key: string;
  /** How it is most often written in your contacts ('מדמ"ח'). */
  display: string;
  count: number;
}

interface WordUse {
  contacts: number;
  first: number;
  spellings: Map<string, number>;
  neighbours: Map<string, number>;
}

function countWords(names: readonly string[]): Map<string, WordUse> {
  const uses = new Map<string, WordUse>();
  for (const name of names) {
    const words = nameWords(name);
    const rawWords = name.split(/\s+/).filter((raw) => raw.length > 0);
    words.forEach((word, position) => {
      if (words.indexOf(word) !== position) return; // each contact counts once per word
      const use = uses.get(word) ?? { contacts: 0, first: 0, spellings: new Map(), neighbours: new Map() };
      use.contacts++;
      if (position === 0 && words.length > 1) use.first++;
      const spelling = rawWords.find((raw) => nameWords(raw).includes(word)) ?? word;
      use.spellings.set(spelling, (use.spellings.get(spelling) ?? 0) + 1);
      for (const neighbour of [words[position - 1], words[position + 1]]) {
        if (neighbour !== undefined) {
          const pair = position > 0 && neighbour === words[position - 1] ? `${neighbour} ${word}` : `${word} ${neighbour}`;
          use.neighbours.set(pair, (use.neighbours.get(pair) ?? 0) + 1);
        }
      }
      uses.set(word, use);
    });
  }
  return uses;
}

function mostCommon(counts: Map<string, number>): [string, number] {
  const top = [...counts].sort((a, b) => b[1] - a[1])[0];
  if (top === undefined) throw new Error('mostCommon needs at least one entry');
  return top;
}

/** Labels used by at least `MIN_LABEL_CONTACTS` contacts, most used first. */
export function detectLabels(names: readonly string[]): Label[] {
  const labels = new Map<string, Label>();
  for (const [word, use] of countWords(names)) {
    const isRole = ROLE_WORDS.has(word);
    const looksLikeFirstName = !isRole && use.first / use.contacts > FIRST_NAME_SHARE;
    if (use.contacts < MIN_LABEL_CONTACTS || NOT_LABELS.has(word) || SERVICE_WORDS.has(word) || looksLikeFirstName) {
      continue;
    }
    const [pair, together] = use.neighbours.size > 0 ? mostCommon(use.neighbours) : ['', 0];
    const isPhrase = together / use.contacts >= PHRASE_SHARE && !isRole;
    const key = isPhrase ? pair : word;
    if (!labels.has(key)) {
      labels.set(key, { key, display: isPhrase ? pair : mostCommon(use.spellings)[0], count: isPhrase ? together : use.contacts });
    }
  }
  return [...labels.values()].sort((a, b) => b.count - a.count);
}
