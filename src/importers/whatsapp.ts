import { assert } from '../model/assert';
import { cleanContact, type RawContact } from './rawContact';
import { isZip, listZipEntries, readZipEntry } from './zip';

/**
 * Reads a WhatsApp "Export chat" — the .zip an iPhone produces (with _chat.txt inside)
 * or the plain .txt from Android — and returns everyone who wrote in it.
 * WhatsApp shows a saved contact by name and an unsaved one by phone number.
 *
 * Supported line shapes (iOS and Android, 12h and 24h clocks):
 *   [12/03/2024, 14:05:33] Moshe Cohen: shalom
 *   12/03/2024, 14:05 - Moshe Cohen: shalom
 *   3/12/24, 2:05 PM - +972 54‑123‑4567: shalom
 */

const INVISIBLE_MARKS = /[‎‏‪-‮⁦-⁩]/g;
const MESSAGE_LINE =
  /^\[?\d{1,4}[./-]\d{1,2}[./-]\d{1,4},?\s\d{1,2}:\d{2}(?::\d{2})?(?:[\s ]?[APap]\.?[Mm]\.?)?\]?(?:\s-)?\s([^:]{1,80}):\s(.*)$/;
/** Digits with spaces, brackets and any kind of dash (WhatsApp uses non-breaking hyphens "‑"). */
const PHONE_ONLY = /^\+?[\d\s ()\-‐-―]{7,}$/;
/** How the exporting user appears in their own export. */
const SELF = /^(you|את\/ה|אתה|את)(\s|$)/i;
/**
 * Lines about the group itself, which iPhone files under the group's own name: my changes to it
 * ("You changed the group name…") and WhatsApp's notices. Not "You added X": that line is filed
 * under X, who is a real member.
 */
const GROUP_EVENT =
  /^((you|את\/ה|אתה|את)\s+(changed|created|deleted|turned|reset|pinned|שינית|יצרת|מחקת)|messages and calls are end-to-end encrypted|messages to this group are now secured|ההודעות והשיחות מוצפנות)/i;

export interface WhatsAppChat {
  /** Name of the chat taken from the file name, e.g. "Family" from "WhatsApp Chat with Family.txt". */
  chatName: string;
  contacts: RawContact[];
}

export function parseWhatsAppChat(text: string, fileName: string): WhatsAppChat {
  /** For each sender: did they ever write anything that is not a group event? */
  const senders = new Map<string, boolean>();
  for (const rawLine of text.split(/\r?\n/)) {
    const match = MESSAGE_LINE.exec(rawLine.replace(INVISIBLE_MARKS, ''));
    if (match === null) {
      continue;
    }
    const sender = (match[1] as string).trim();
    const isGroupEvent = GROUP_EVENT.test((match[2] as string).trim());
    senders.set(sender, (senders.get(sender) ?? false) || !isGroupEvent);
  }
  // "You" is me; a "sender" whose every line is a group event ("108 בלי ניר: You changed the
  // group name…") is the group itself, as iPhone exports label those lines.
  const people = [...senders].filter(([sender, isPerson]) => isPerson && !SELF.test(sender)).map(([sender]) => sender);
  const contacts = people.map((sender) =>
    cleanContact(PHONE_ONLY.test(sender) ? { name: sender, phones: [sender], emails: [] } : { name: sender, phones: [], emails: [] }),
  );
  return { chatName: chatNameFromFile(fileName), contacts };
}

/** Opens an export as chosen in the file picker: a .zip (iPhone) or the .txt itself (Android). */
export async function readWhatsAppExport(fileName: string, bytes: Uint8Array): Promise<WhatsAppChat> {
  if (!isZip(bytes)) {
    return parseWhatsAppChat(new TextDecoder('utf-8').decode(bytes), fileName);
  }
  const texts = listZipEntries(bytes).filter((entry) => /\.txt$/i.test(entry.name) && !entry.name.startsWith('__MACOSX'));
  const chat = texts.find((entry) => /(^|\/)_?chat\.txt$/i.test(entry.name)) ?? texts[0];
  assert(chat !== undefined, 'this zip has no chat text in it — export the chat from WhatsApp again');
  return parseWhatsAppChat(new TextDecoder('utf-8').decode(await readZipEntry(bytes, chat)), fileName);
}

function chatNameFromFile(fileName: string): string {
  return fileName
    .replace(/\.(txt|zip)$/i, '')
    .replace(/^WhatsApp Chat (with|-)\s*/i, '')
    .replace(/^צ'אט WhatsApp עם\s*/, '')
    .trim();
}
