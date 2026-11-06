import { identityKeys } from '../model/identity';
import type { Person } from '../model/types';
import { bloomHas } from './bloom';
import type { ComparePayload } from './payload';

/**
 * Receiver side of a comparison: which of MY contacts does my friend also know,
 * and is my friend already in my graph?
 * Runs entirely on the receiver's phone; nothing about my contacts is sent anywhere.
 */

export interface Overlap {
  /** My existing node for the friend (matched by their phone/email), or null. */
  friendId: string | null;
  /** People I know whom the friend probably knows too (≈0.5% may be false matches). */
  commonIds: string[];
}

export function findOverlap(payload: ComparePayload, people: readonly Person[], meId: string): Overlap {
  const friendKeys = new Set(identityKeys({ phones: payload.phones, emails: payload.emails }));
  const friend = people.find(
    (person) => person.id !== meId && identityKeys(person).some((key) => friendKeys.has(key)),
  );
  const friendId = friend === undefined ? null : friend.id;
  const commonIds = people
    .filter((person) => person.id !== meId && person.id !== friendId)
    .filter((person) => identityKeys(person).some((key) => bloomHas(payload.filter, key)))
    .map((person) => person.id);
  return { friendId, commonIds };
}
