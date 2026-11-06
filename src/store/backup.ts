import { assert } from '../model/assert';
import { isRelationType, type Group, type Person, type Relation, type Settings, type Suggestion } from '../model/types';

/**
 * Backup file format. Data lives only on this device, so an exported backup
 * is the way to move to a new phone or recover after clearing the browser.
 */
export interface Backup {
  app: 'jewish-geography';
  version: 1;
  exportedAt: string;
  settings: Settings;
  people: Person[];
  relations: Relation[];
  groups: Group[];
  suggestions: Suggestion[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expectArray(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  assert(Array.isArray(value), `backup.${key} must be a list`);
  return value;
}

function expectString(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key];
  assert(typeof value === 'string', `${where}.${key} must be text`);
  return value;
}

/** Parses and validates a backup file; throws a clear error on anything unexpected. */
export function parseBackup(json: string): Backup {
  const data: unknown = JSON.parse(json);
  assert(isObject(data), 'backup must be a JSON object');
  assert(data['app'] === 'jewish-geography', 'this is not a Jewish Geography backup file');
  assert(data['version'] === 1, `unsupported backup version ${String(data['version'])}`);

  const settings = data['settings'];
  assert(isObject(settings), 'backup.settings is missing');
  const meId = expectString(settings, 'meId', 'settings');
  const language = settings['language'];
  assert(language === 'en' || language === 'he', 'settings.language must be "en" or "he"');

  const people = expectArray(data, 'people');
  const personIds = new Set<string>();
  for (const person of people) {
    assert(isObject(person), 'every person must be an object');
    personIds.add(expectString(person, 'id', 'person'));
    expectString(person, 'name', 'person');
    assert(Array.isArray(person['phones']) && Array.isArray(person['emails']) && Array.isArray(person['groupIds']), 'person lists are malformed');
  }
  assert(personIds.has(meId), 'backup does not contain "me"');

  for (const relation of expectArray(data, 'relations')) {
    assert(isObject(relation), 'every relation must be an object');
    assert(isRelationType(expectString(relation, 'type', 'relation')), `unknown relation type ${String(relation['type'])}`);
    assert(personIds.has(expectString(relation, 'from', 'relation')), 'relation points to a missing person');
    assert(personIds.has(expectString(relation, 'to', 'relation')), 'relation points to a missing person');
  }
  for (const group of expectArray(data, 'groups')) {
    assert(isObject(group), 'every group must be an object');
    expectString(group, 'id', 'group');
    expectString(group, 'name', 'group');
  }
  expectArray(data, 'suggestions');

  return data as unknown as Backup;
}
