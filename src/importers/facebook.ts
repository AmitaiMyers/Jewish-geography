import { assert } from '../model/assert';
import { cleanContact, type RawContact } from './rawContact';

/**
 * Reads friends.json from a Facebook "Download your information" export (JSON format).
 * Facebook writes UTF-8 bytes as \u00XX escapes, so Hebrew names arrive garbled;
 * `repairFacebookText` turns them back into real characters.
 */
export function parseFacebookFriends(text: string): RawContact[] {
  const data: unknown = JSON.parse(text);
  assert(typeof data === 'object' && data !== null, 'Facebook file must contain a JSON object');
  const record = data as Record<string, unknown>;
  const friends = 'friends_v2' in record ? record['friends_v2'] : record['friends'];
  assert(Array.isArray(friends), 'Facebook file has no "friends_v2" list — choose friends.json from the export');

  return friends.map((friend: unknown) => {
    assert(typeof friend === 'object' && friend !== null && 'name' in friend, 'each Facebook friend must have a name');
    const name = (friend as { name: unknown }).name;
    assert(typeof name === 'string', 'Facebook friend name must be text');
    return cleanContact({ name: repairFacebookText(name), phones: [], emails: [] });
  });
}

export function repairFacebookText(text: string): string {
  const isByteString = [...text].every((char) => char.charCodeAt(0) < 256);
  if (!isByteString) {
    return text;
  }
  const bytes = Uint8Array.from([...text].map((char) => char.charCodeAt(0)));
  return new TextDecoder('utf-8').decode(bytes);
}
