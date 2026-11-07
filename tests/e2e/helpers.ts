import { expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export const fixture = (name: string): string => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

/** The visible (open) sheet dialog — the one on top. */
export const openSheet = (page: Page) => page.locator('dialog.sheet[open]').last();

export async function onboard(page: Page, name: string, phone: string, language: 'English' | 'עברית' = 'English'): Promise<void> {
  await page.goto('/');
  const welcome = page.locator('#onboarding');
  await expect(welcome).toBeVisible();
  if (language !== 'English') {
    await welcome.locator('select').selectOption({ label: language });
  }
  await welcome.locator('input[autocomplete=name]').fill(name);
  await welcome.locator('input[type=tel]').fill(phone);
  await welcome.locator('button[type=submit]').click();
  await expect(welcome).toBeHidden();
}

/** A generated .vcf (synthetic people only — never real contacts in tests). */
export function vcfFile(names: string[]): { name: string; mimeType: string; buffer: Buffer } {
  const cards = names.map((name, i) => `BEGIN:VCARD\nVERSION:3.0\nFN:${name}\nTEL:050-${String(1000000 + i)}\nEND:VCARD`);
  return { name: 'generated.vcf', mimeType: 'text/vcard', buffer: Buffer.from(cards.join('\n'), 'utf8') };
}

/** From the "Bring in your people" / import sheet: pick a .vcf and import everything new. */
export async function importVcf(page: Page, file: string | ReturnType<typeof vcfFile>, groupName = ''): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await openSheet(page).getByRole('button', { name: /Contacts file|קובץ אנשי קשר/ }).click();
  await (await chooser).setFiles(typeof file === 'string' ? fixture(file) : file);
  const review = openSheet(page);
  await expect(review.getByRole('heading', { name: /Who should come in|מי נכנס/ })).toBeVisible();
  if (groupName !== '') {
    await review.locator('select').first().selectOption('__new__');
    await review.getByRole('textbox', { name: /Group name|שם הקבוצה/ }).fill(groupName);
  }
  await review.getByRole('button', { name: /^(Import|ייבוא) \d+/ }).click();
  await expect(review).toBeHidden();
}

export async function goToTab(page: Page, name: RegExp): Promise<void> {
  await page.getByRole('tab', { name }).click();
}
