import { cleanContact, type RawContact } from './rawContact';

/**
 * Minimal vCard (.vcf) reader covering what iPhone, Android and Google Contacts export:
 * FN / N for the name, TEL and EMAIL, line folding and quoted-printable values.
 */

interface Property {
  name: string;
  params: string[];
  value: string;
}

export function parseVCards(text: string): RawContact[] {
  const lines = joinQuotedPrintableSoftBreaks(unfold(text).split(/\r?\n/));
  const contacts: RawContact[] = [];
  let card: Property[] | null = null;

  for (const line of lines) {
    const property = parseLine(line);
    if (property === null) {
      continue;
    }
    if (property.name === 'BEGIN' && property.value.toUpperCase() === 'VCARD') {
      card = [];
    } else if (property.name === 'END' && property.value.toUpperCase() === 'VCARD') {
      if (card !== null) {
        const contact = toContact(card);
        if (contact !== null) {
          contacts.push(contact);
        }
      }
      card = null;
    } else if (card !== null) {
      card.push(property);
    }
  }
  return contacts;
}

/** RFC 6350 folding: a newline followed by a space or tab continues the previous line. */
function unfold(text: string): string {
  return text.replace(/\r?\n[ \t]/g, '');
}

/** Quoted-printable lines ending in "=" continue on the next line. */
function joinQuotedPrintableSoftBreaks(lines: string[]): string[] {
  const joined: string[] = [];
  for (const line of lines) {
    const previous = joined[joined.length - 1];
    if (previous !== undefined && /QUOTED-PRINTABLE/i.test(previous) && previous.endsWith('=')) {
      joined[joined.length - 1] = previous.slice(0, -1) + line.trim();
    } else {
      joined.push(line);
    }
  }
  return joined;
}

function parseLine(line: string): Property | null {
  const colon = line.indexOf(':');
  if (colon <= 0) {
    return null;
  }
  const [rawName, ...params] = line.slice(0, colon).split(';');
  const nameWithoutGroup = (rawName as string).split('.').pop() as string;
  const name = nameWithoutGroup.toUpperCase();
  const isQuotedPrintable = params.some((param) => /QUOTED-PRINTABLE/i.test(param));
  const rawValue = line.slice(colon + 1);
  const value = isQuotedPrintable ? decodeQuotedPrintable(rawValue) : rawValue;
  return { name, params, value };
}

function decodeQuotedPrintable(value: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < value.length; i++) {
    const char = value[i] as string;
    const hex = value.slice(i + 1, i + 3);
    if (char === '=' && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      bytes.push(...new TextEncoder().encode(char));
    }
  }
  return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
}

function unescapeText(value: string): string {
  return value.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1');
}

function nameFromStructured(value: string): string {
  // N:Family;Given;Additional;Prefix;Suffix
  const [family = '', given = '', additional = '', prefix = '', suffix = ''] = value
    .split(/(?<!\\);/)
    .map(unescapeText);
  return [prefix, given, additional, family, suffix].filter((part) => part.trim().length > 0).join(' ');
}

function toContact(properties: Property[]): RawContact | null {
  const formatted = properties.find((p) => p.name === 'FN');
  const structured = properties.find((p) => p.name === 'N');
  const phones = properties.filter((p) => p.name === 'TEL').map((p) => p.value.replace(/^tel:/i, ''));
  const emails = properties.filter((p) => p.name === 'EMAIL').map((p) => p.value);

  let name = formatted !== undefined ? unescapeText(formatted.value) : '';
  if (name.trim() === '' && structured !== undefined) {
    name = nameFromStructured(structured.value);
  }
  if (name.trim() === '') {
    name = phones[0] ?? emails[0] ?? '';
  }
  if (name.trim() === '') {
    return null;
  }
  return cleanContact({ name, phones, emails });
}
