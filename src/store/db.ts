import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Group, Person, Relation, Settings, Suggestion } from '../model/types';

/** Everything lives on the device in IndexedDB; nothing is sent to a server. */

export interface GeographyDB extends DBSchema {
  people: { key: string; value: Person };
  relations: { key: string; value: Relation };
  groups: { key: string; value: Group };
  suggestions: { key: string; value: Suggestion };
  settings: { key: 'settings'; value: Settings };
}

export type StoreName = 'people' | 'relations' | 'groups' | 'suggestions' | 'settings';
export const DATA_STORES = ['people', 'relations', 'groups', 'suggestions'] as const;

const DB_NAME = 'jewish-geography';
const DB_VERSION = 1;

export function openDatabase(): Promise<IDBPDatabase<GeographyDB>> {
  return openDB<GeographyDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      db.createObjectStore('people', { keyPath: 'id' });
      db.createObjectStore('relations', { keyPath: 'id' });
      db.createObjectStore('groups', { keyPath: 'id' });
      db.createObjectStore('suggestions', { keyPath: 'id' });
      db.createObjectStore('settings');
    },
  });
}
