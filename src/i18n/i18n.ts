import type { Language, Relation, RelationType } from '../model/types';
import { en, he, type StringKey } from './strings';

const DICTIONARIES: Record<Language, Record<StringKey, string>> = { en, he };

let current: Language = 'en';

export function setLanguage(language: Language): void {
  current = language;
}

/** Hebrew flips the whole layout to right-to-left. */
export function applyLanguageToDocument(): void {
  document.documentElement.lang = current;
  document.documentElement.dir = current === 'he' ? 'rtl' : 'ltr';
}

export function language(): Language {
  return current;
}

/** Translate a key, filling {placeholders} from params. Unknown placeholders fail fast. */
export function t(key: StringKey, params: Record<string, string | number> = {}): string {
  return DICTIONARIES[current][key].replace(/\{(\w+)\}/g, (_, name: string) => {
    if (!(name in params)) {
      throw new Error(`Missing parameter "${name}" for string "${key}"`);
    }
    return String(params[name]);
  });
}

/** Keys whose count of exactly 1 needs its own wording ("1 connection", "קשר אחד"). */
const SINGULAR: Partial<Record<StringKey, StringKey>> = {
  connectionsCount: 'connectionsCountOne',
  membersCount: 'membersCountOne',
  steps: 'stepsOne',
  compareDone: 'compareDoneOne',
  importGroups: 'importGroupsOne',
  importSuggestions: 'importSuggestionsOne',
};

/** Like t(), choosing the singular form when count is 1. */
export function tCount(key: StringKey, count: number, params: Record<string, string | number> = {}): string {
  const singular = SINGULAR[key];
  return t(count === 1 && singular !== undefined ? singular : key, { ...params, count });
}

export function relationTypeName(type: RelationType): string {
  return t(`type_${type}`);
}

/** How a relation reads from one side: "parent of", "child of", "Uncle", "friend". */
export function relationLabelFrom(relation: Relation, fromPersonId: string): string {
  if (relation.type === 'parent') {
    return relation.from === fromPersonId ? t('edgeParentOf') : t('edgeChildOf');
  }
  return relation.label !== '' ? relation.label : relationTypeName(relation.type);
}
