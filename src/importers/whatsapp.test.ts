import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readWhatsAppExport } from './whatsapp';
import { isZip, listZipEntries } from './zip';

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(`../../tests/e2e/fixtures/${name}`, import.meta.url)));

describe('WhatsApp export from an iPhone (.zip)', () => {
  it.each(['whatsapp-iphone.zip', 'whatsapp-stored.zip'])('reads the chat inside %s', async (file) => {
    const bytes = fixture(file);
    expect(isZip(bytes)).toBe(true);
    expect(listZipEntries(bytes).map((entry) => entry.name)).toEqual(['_chat.txt']);
    const chat = await readWhatsAppExport('WhatsApp Chat - 108 משפחה.zip', bytes);
    expect(chat.chatName).toBe('108 משפחה');
    // Not the group itself ("108 משפחה"), not "You"; "You added המפקד חגי" keeps him as a member.
    expect(chat.contacts).toEqual([
      { name: 'יובל זלצמן', phones: [], emails: [] },
      { name: 'אבי', phones: [], emails: [] },
      { name: 'Sarah Cohen', phones: [], emails: [] },
      { name: '+972 57‑247‑9596', phones: ['+972 57‑247‑9596'], emails: [] },
      { name: 'המפקד חגי', phones: [], emails: [] },
    ]);
  });

  it('still reads a plain .txt export (Android)', async () => {
    const text = '12/03/2024, 14:05 - Moshe Cohen: shalom\n';
    const chat = await readWhatsAppExport('WhatsApp Chat with Cousins.txt', new TextEncoder().encode(text));
    expect(chat).toEqual({ chatName: 'Cousins', contacts: [{ name: 'Moshe Cohen', phones: [], emails: [] }] });
  });

  it('fails clearly on a zip without a chat', async () => {
    const notAChat = fixture('whatsapp-iphone.zip');
    const renamed = new Uint8Array(notAChat);
    const name = new TextEncoder().encode('_chat.txt');
    // Rename the entry in both headers so no .txt remains.
    for (let i = 0; i + name.length <= renamed.length; i++) {
      if (name.every((byte, j) => renamed[i + j] === byte)) renamed.set(new TextEncoder().encode('_chat.bin'), i);
    }
    await expect(readWhatsAppExport('x.zip', renamed)).rejects.toThrow(/no chat text/);
  });
});
