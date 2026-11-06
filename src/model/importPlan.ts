import type { RawContact } from '../importers/rawContact';
import { identityKeys, normalizeName } from './identity';
import type { Person } from './types';

/**
 * Decides, for each imported contact, whether it is already in the graph.
 *  - same phone (last 9 digits) or email → certainly the same person
 *  - no phone/email but the exact same name → probably the same person
 * Matches start unticked in the review screen; the user has the final say.
 */

export type MatchReason = 'identifier' | 'name' | 'none';

export interface ImportCandidate {
  contact: RawContact;
  existingPersonId: string | null;
  reason: MatchReason;
}

export function planImport(contacts: readonly RawContact[], people: readonly Person[]): ImportCandidate[] {
  const byIdentity = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const person of people) {
    identityKeys(person).forEach((key) => byIdentity.set(key, person.id));
    byName.set(normalizeName(person.name), person.id);
  }

  const seenInBatch = new Set<string>();
  const candidates: ImportCandidate[] = [];
  for (const contact of contacts) {
    const keys = identityKeys(contact);
    const batchKeys = keys.length > 0 ? keys : [`n:${normalizeName(contact.name)}`];
    if (batchKeys.some((key) => seenInBatch.has(key))) {
      continue;
    }
    batchKeys.forEach((key) => seenInBatch.add(key));

    const identityMatch = keys.map((key) => byIdentity.get(key)).find((id) => id !== undefined);
    if (identityMatch !== undefined) {
      candidates.push({ contact, existingPersonId: identityMatch, reason: 'identifier' });
      continue;
    }
    const nameMatch = keys.length === 0 ? byName.get(normalizeName(contact.name)) : undefined;
    candidates.push(
      nameMatch !== undefined
        ? { contact, existingPersonId: nameMatch, reason: 'name' }
        : { contact, existingPersonId: null, reason: 'none' },
    );
  }
  return candidates;
}
