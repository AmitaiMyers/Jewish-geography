/** A contact as read from any import source, before it becomes a Person. */
export interface RawContact {
  name: string;
  phones: string[];
  emails: string[];
}

export function cleanContact(contact: RawContact): RawContact {
  return {
    name: contact.name.replace(/\s+/g, ' ').trim(),
    phones: unique(contact.phones.map((phone) => phone.trim()).filter((phone) => phone.length > 0)),
    emails: unique(contact.emails.map((email) => email.trim()).filter((email) => email.length > 0)),
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
