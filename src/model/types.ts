/**
 * Core domain types. Everything the app stores is one of these shapes.
 */

export type Gender = 'male' | 'female' | 'unknown';

export type PersonSource = 'manual' | 'contacts' | 'vcard' | 'whatsapp' | 'facebook' | 'compare' | 'self';

export interface Person {
  id: string;
  name: string;
  gender: Gender;
  phones: string[];
  emails: string[];
  groupIds: string[];
  /** Other ways this person is written ("אמיתי מיירס" for "Amitai Myers", a nickname…). */
  otherNames: string[];
  notes: string;
  source: PersonSource;
  createdAt: number;
}

/**
 * Family primitives drive kinship inference (uncle, cousin, in-law...).
 *  - parent:  edge.from IS THE PARENT OF edge.to (directed)
 *  - spouse:  undirected
 *  - sibling: undirected (use when the shared parents are unknown)
 * `relative` is a family link the inference engine cannot reason about (free label).
 * The rest are social links.
 */
export const FAMILY_PRIMITIVE_TYPES = ['parent', 'spouse', 'sibling'] as const;
/** `knows` is the generic link created when comparing graphs with a friend. */
export const SOCIAL_TYPES = ['friend', 'school', 'work', 'shul', 'neighbor', 'camp', 'army', 'knows'] as const;
export const LABELLED_TYPES = ['relative', 'custom'] as const;

export type FamilyPrimitiveType = (typeof FAMILY_PRIMITIVE_TYPES)[number];
export type SocialType = (typeof SOCIAL_TYPES)[number];
export type LabelledType = (typeof LABELLED_TYPES)[number];
export type RelationType = FamilyPrimitiveType | SocialType | LabelledType;

export const ALL_RELATION_TYPES: readonly RelationType[] = [
  ...FAMILY_PRIMITIVE_TYPES,
  ...LABELLED_TYPES,
  ...SOCIAL_TYPES,
];

export interface Relation {
  id: string;
  from: string;
  to: string;
  type: RelationType;
  /** Required for `relative` and `custom`, empty otherwise. */
  label: string;
  createdAt: number;
}

export interface Group {
  id: string;
  name: string;
  color: string;
}

/** A link proposed by the importer from a contact's name; the user accepts or dismisses it. */
export interface Suggestion {
  id: string;
  from: string;
  to: string;
  type: RelationType;
  label: string;
  /** The contact whose name produced the suggestion. */
  subjectId: string;
  /** Gender implied by the word ("mom" → female); applied to the subject on accept. */
  genderHint: Gender;
  /** The text that produced the suggestion, shown to the user as the reason. */
  evidence: string;
  /**
   * Set when the named person is ambiguous ("אמא של רז" with fifteen Raz) or missing ("אמא של יושו").
   * The endpoint on `side` is '' until the user picks a candidate (or a new person) on the card.
   */
  unresolved: UnresolvedEndpoint | null;
  /** The name says "family" but not how ("יוני מיירס" shares my surname): the card asks which relation. */
  askKind: boolean;
}

/** The relation picked on a card for an `askKind` suggestion, from the subject's point of view to me. */
export type FamilyKind = 'parent' | 'child' | 'sibling' | 'spouse' | 'relative';

export interface UnresolvedEndpoint {
  side: 'from' | 'to';
  /** The name as written in the contact ("רז"). */
  name: string;
  candidateIds: string[];
  /** Parent/child hints may add the missing person ("יושו") as a new node. */
  canCreate: boolean;
}

/** How the user resolved an unresolved suggestion. */
export type EndpointChoice = { personId: string } | { newPersonName: string };

export interface Settings {
  meId: string;
  language: Language;
  /** Keys (see `suggestionKey`) of suggestions the user discarded, so "Look again" does not bring them back. */
  dismissedSuggestions: string[];
}

export type Language = 'en' | 'he';

export function isFamilyPrimitive(type: RelationType): type is FamilyPrimitiveType {
  return (FAMILY_PRIMITIVE_TYPES as readonly string[]).includes(type);
}

export function isLabelledType(type: RelationType): type is LabelledType {
  return (LABELLED_TYPES as readonly string[]).includes(type);
}

export function isFamilyType(type: RelationType): boolean {
  return isFamilyPrimitive(type) || type === 'relative';
}

export function isRelationType(value: string): value is RelationType {
  return (ALL_RELATION_TYPES as readonly string[]).includes(value);
}
