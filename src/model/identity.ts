/**
 * Normalising contact identifiers so the same person imported twice
 * (or from two sources) is recognised as one node.
 */

const PHONE_MATCH_DIGITS = 9;

/** Digits only, international "00" prefix dropped. "+972 (54) 123-4567" -> "972541234567". */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return digits.startsWith('00') ? digits.slice(2) : digits;
}

/**
 * Key used to decide if two phone numbers belong to the same person.
 * Uses the last 9 digits so "054-1234567" and "+972 54 1234567" match
 * without needing to know the user's country code.
 */
export function phoneMatchKey(raw: string): string {
  return normalizePhone(raw).slice(-PHONE_MATCH_DIGITS);
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Lowercased, accent-free, single-spaced name for search and name matching. */
export function normalizeName(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[̀-֑ͯ-ׇ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export interface Identifiable {
  phones: readonly string[];
  emails: readonly string[];
}

export function identityKeys(person: Identifiable): string[] {
  const phoneKeys = person.phones.map((phone) => `p:${phoneMatchKey(phone)}`).filter((key) => key.length > 2);
  const emailKeys = person.emails.map((email) => `e:${normalizeEmail(email)}`).filter((key) => key.length > 2);
  return [...phoneKeys, ...emailKeys];
}
