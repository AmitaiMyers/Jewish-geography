import { cleanContact, type RawContact } from './rawContact';

/**
 * Reads a WhatsApp "Export chat" .txt file and returns everyone who wrote in it.
 * WhatsApp shows a saved contact by name and an unsaved one by phone number.
 *
 * Supported line shapes (iOS and Android, 12h and 24h clocks):
 *   [12/03/2024, 14:05:33] Moshe Cohen: shalom
 *   12/03/2024, 14:05 - Moshe Cohen: shalom
 *   3/12/24, 2:05 PM - +972 54-123-4567: shalom
 */

const INVISIBLE_MARKS = /[‎‏‪-‮⁦-⁩]/g;
const MESSAGE_LINE =
  /^\[?\d{1,4}[./-]\d{1,2}[./-]\d{1,4},?\s\d{1,2}:\d{2}(?::\d{2})?(?:[\s ]?[APap]\.?[Mm]\.?)?\]?(?:\s-)?\s([^:]{1,80}):\s/;
const PHONE_ONLY = /^\+?[\d\s()\-]{7,}$/;

export interface WhatsAppChat {
  /** Name of the chat taken from the file name, e.g. "Family" from "WhatsApp Chat with Family.txt". */
  chatName: string;
  contacts: RawContact[];
}

export function parseWhatsAppChat(text: string, fileName: string): WhatsAppChat {
  const senders = new Set<string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const match = MESSAGE_LINE.exec(rawLine.replace(INVISIBLE_MARKS, ''));
    if (match !== null) {
      senders.add((match[1] as string).trim());
    }
  }
  const contacts = [...senders].map((sender) =>
    cleanContact(PHONE_ONLY.test(sender) ? { name: sender, phones: [sender], emails: [] } : { name: sender, phones: [], emails: [] }),
  );
  return { chatName: chatNameFromFile(fileName), contacts };
}

function chatNameFromFile(fileName: string): string {
  return fileName
    .replace(/\.(txt|zip)$/i, '')
    .replace(/^WhatsApp Chat (with|-)\s*/i, '')
    .replace(/^צ'אט WhatsApp עם\s*/, '')
    .trim();
}
