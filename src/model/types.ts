/**
 * Core domain types. Everything the app stores is one of these shapes.
 */

export type Gender = 'male' | 'female' | 'unknown';

export type PersonSource = 'manual' | 'contacts' | 'vcard' | 'whatsapp' | 'facebook' | 'self';

export interface Person {
  id: string;
  name: string;
  gender: Gender;
  phones: string[];
  emails: string[];
  groupIds: string[];
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
export const SOCIAL_TYPES = ['friend', 'school', 'work', 'shul', 'neighbor', 'camp', 'army'] as const;
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
}

export interface Settings {
  meId: string;
  language: Language;
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
