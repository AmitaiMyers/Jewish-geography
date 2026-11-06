import { cleanContact, type RawContact } from './rawContact';

/**
 * Contact Picker API — Chrome on Android only (iPhone Safari does not ship it).
 * The user chooses which contacts to share; the app never sees the rest.
 */

interface PickedContact {
  name: string[];
  tel: string[];
  email: string[];
}

interface ContactsManager {
  select(properties: string[], options: { multiple: boolean }): Promise<PickedContact[]>;
}

function contactsManager(): ContactsManager | null {
  return 'contacts' in navigator ? (navigator as Navigator & { contacts: ContactsManager }).contacts : null;
}

export function isContactPickerSupported(): boolean {
  return contactsManager() !== null && 'ContactsManager' in window;
}

export async function pickPhoneContacts(): Promise<RawContact[]> {
  const manager = contactsManager();
  if (manager === null) {
    throw new Error('This browser cannot open your phone contacts. Import a .vcf file instead.');
  }
  const picked = await manager.select(['name', 'tel', 'email'], { multiple: true });
  return picked
    .map((contact) =>
      cleanContact({
        name: contact.name[0] ?? contact.tel[0] ?? contact.email[0] ?? '',
        phones: contact.tel,
        emails: contact.email,
      }),
    )
    .filter((contact) => contact.name.length > 0);
}
