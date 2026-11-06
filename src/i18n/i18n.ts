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

export function relationTypeName(type: RelationType): string {
  return t(`type_${type}`);
}

/** How a relation reads from one side: "parent of", "child of", "Uncle", "friend". */
export function relationLabelFrom(relation: Relation, fromPersonId: string): string {
  if (relation.type === 'parent') {
    return relation.from === fromPersonId ? t('typeParentOf') : t('typeChildOf');
  }
  return relation.label !== '' ? relation.label : relationTypeName(relation.type);
}
