import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fixture, goToTab, importVcf, onboard, openSheet, vcfFile } from './helpers';

test.describe('first-run journey', () => {
  test('onboard, import, review suggestions, infer family, find a chain', async ({ page }) => {
    await onboard(page, 'Amitai Myers', '054-999-0000');
    await expect(openSheet(page).getByRole('heading', { name: 'Bring in your people' })).toBeVisible();
    await importVcf(page, 'family.vcf', 'Family');

    // Toast offers the suggestions found in contact names ("Mom", "Dad", "Rivka (Sarah's mom)").
    await page.locator('#toast').getByRole('button', { name: 'Review' }).click();
    const cards = openSheet(page);
    for (let i = 0; i < 3; i++) {
      await cards.getByRole('button', { name: 'Accept', exact: true }).click();
    }
    await expect(cards.getByRole('heading', { name: 'All reviewed!' })).toBeVisible();
    await cards.getByRole('button', { name: 'Done' }).click();

    // Kinship labels inferred from the accepted parent links (gender came from "Mom"/"Dad").
    await goToTab(page, /People/);
    await expect(page.locator('#view-people li', { hasText: 'Dad' }).locator('.tag')).toHaveText('father');
    await expect(page.locator('#view-people li', { hasText: 'Mom' }).locator('.tag')).toHaveText('mother');

    // Add a connection with the sentence builder: Avi is the sibling of Amitai → brother/sibling.
    await page.locator('#view-people li', { hasText: 'Avi Levi' }).getByRole('button').click();
    const sheet = openSheet(page);
    await sheet.getByRole('combobox', { name: 'Connection type' }).selectOption('sibling');
    await sheet.getByRole('combobox', { name: 'Choose a person…' }).fill('Amitai');
    await sheet.getByRole('option', { name: /Amitai/ }).click();
    await sheet.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(sheet.getByText('Your sibling')).toBeVisible();
    await sheet.getByRole('button', { name: 'How are we connected?' }).click();

    // Connect tab: Avi → Mom is "mother" through the shared parent.
    await expect(page.locator('#view-connect')).toBeVisible();
    await page.locator('#view-connect').getByRole('combobox', { name: 'To' }).fill('Mom');
    await page.locator('#view-connect').getByRole('option', { name: 'Mom', exact: true }).click();
    await expect(page.locator('#view-connect .big-answer')).toHaveText('Mom is Amitai Myers’s mother');
    await expect(page.locator('#view-connect .ribbon-node')).toHaveCount(2);
  });

  test('delete offers undo instead of a confirmation', async ({ page }) => {
    await onboard(page, 'Amitai', '');
    await importVcf(page, 'family.vcf');
    await goToTab(page, /People/);
    await page.locator('#view-people li', { hasText: 'Sarah Cohen' }).getByRole('button').click();
    await openSheet(page).getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('#view-people li', { hasText: 'Sarah Cohen' })).toHaveCount(0);
    await page.locator('#toast').getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator('#view-people li', { hasText: 'Sarah Cohen' })).toHaveCount(1);
  });
});

test('Hebrew flips the whole app to right-to-left', async ({ page }) => {
  await onboard(page, 'עמיתי', '', 'עברית');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('tab', { name: 'אנשים' })).toBeVisible();
  await expect(openSheet(page).getByRole('heading', { name: 'הביאו את האנשים שלכם' })).toBeVisible();
});

test('two friends compare graphs and see who they both know', async ({ browser }) => {
  const amitai = await (await browser.newContext()).newPage();
  const yossi = await (await browser.newContext()).newPage();

  await onboard(amitai, 'Amitai', '054-999-0000');
  await importVcf(amitai, 'family.vcf');
  await onboard(yossi, 'Yossi', '052-111-1111');
  await importVcf(yossi, 'friend.vcf');

  // Amitai shows his code…
  await goToTab(amitai, /Connect/);
  await amitai.getByRole('button', { name: 'Show my code' }).click();
  const code = await openSheet(amitai).locator('.qr-card').getAttribute('data-code');
  expect(code).toMatch(/^JG1:/);

  // …Yossi pastes it (no camera in the test browser).
  await goToTab(yossi, /Connect/);
  await yossi.getByRole('button', { name: 'Scan their code' }).click();
  await openSheet(yossi).getByRole('textbox', { name: 'Paste a code' }).fill(code as string);
  await openSheet(yossi).getByRole('button', { name: 'Compare' }).click();

  const review = openSheet(yossi);
  await expect(review.getByRole('heading', { name: 'You and Amitai both know 1' })).toBeVisible();
  await expect(review.getByText('Amitai is already in your graph.')).toBeVisible();
  await expect(review.getByRole('checkbox', { name: 'Sarah C' })).toBeChecked();
  await review.getByRole('button', { name: 'Add to my graph' }).click();
  await expect(yossi.locator('#toast')).toContainText('Amitai is now in your graph with 1 shared connection.');

  // Yossi can now trace a chain to Sarah through Amitai's link.
  await goToTab(yossi, /People/);
  await expect(yossi.locator('#view-people li', { hasText: 'Amitai' })).toContainText('2 connections');
});

async function expectAccessible(page: Page, label: string): Promise<void> {
  // @axe-core/playwright is typed against a newer playwright-core than the pinned test runner; same runtime API.
  const axePage = page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'];
  const results = await new AxeBuilder({ page: axePage }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
  expect(
    serious.map((violation) => `${label}: ${violation.id} — ${violation.help} — ${violation.nodes.map((node) => `${node.target.join(' ')} ${node.failureSummary ?? ''}`).join(' | ')}`),
  ).toEqual([]);
}

test('no serious accessibility violations on the main screens', async ({ page }) => {
  await onboard(page, 'Amitai', '054-999-0000');
  await importVcf(page, 'family.vcf', 'Family');
  await page.locator('#toast').getByRole('button', { name: 'Review' }).click();
  await expectAccessible(page, 'suggestions');
  await openSheet(page).getByRole('button', { name: 'Close' }).click();

  for (const [tab, label] of [
    [/Graph/, 'graph'],
    [/People/, 'people'],
    [/Connect/, 'connect'],
    [/Me/, 'me'],
  ] as const) {
    await goToTab(page, tab);
    await expectAccessible(page, label);
  }
  await goToTab(page, /People/);
  await page.locator('#view-people li', { hasText: 'Sarah Cohen' }).getByRole('button').click();
  await expectAccessible(page, 'person sheet');
});

test('1,500 contacts: import stays fast, cards advance, the graph appears', async ({ page }) => {
  test.setTimeout(120_000);
  const names = [...Array.from({ length: 1500 }, (_, i) => `Person ${i}`), 'שאול כהן', 'אמא שאול', 'Mom'];
  await onboard(page, 'Amitai', '054-999-0000');
  const started = Date.now();
  await importVcf(page, vcfFile(names));
  await expect(page.locator('#toast')).toContainText('Added 1503 people', { timeout: 20_000 });
  expect(Date.now() - started).toBeLessThan(20_000);

  // Unconnected people are hidden behind a chip; the empty state points to the found family links.
  await expect(page.getByRole('heading', { name: '1503 people, no connections yet' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show 1503 not connected yet' }).first()).toBeVisible();

  await page.locator('#toast').getByRole('button', { name: 'Review' }).click();
  const cards = openSheet(page);
  await expect(cards.getByText('1 of 2')).toBeVisible();
  await cards.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(cards.getByText('2 of 2')).toBeVisible({ timeout: 5_000 });
  await cards.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(cards.getByRole('heading', { name: 'All reviewed!' })).toBeVisible({ timeout: 5_000 });
  await cards.getByRole('button', { name: 'Done' }).click();

  // "אמא שאול" became Shaul's mother, not mine.
  await goToTab(page, /People/);
  await page.locator('#view-people').getByRole('searchbox').fill('אמא שאול');
  await page.locator('#view-people li', { hasText: 'אמא שאול' }).getByRole('button').click();
  await expect(openSheet(page).locator('.tag', { hasText: 'parent of' })).toBeVisible();
  await expect(openSheet(page).locator('.list-row', { hasText: 'שאול כהן' })).toBeVisible();
});

test('rescanning names refreshes waiting suggestions without duplicating them', async ({ page }) => {
  await onboard(page, 'Amitai', '');
  await importVcf(page, vcfFile(['Mom', 'שאול כהן', 'אמא שאול', ...['תומר', 'גל', 'נועה', 'יובל', 'עידן'].map((first) => `${first} מדמ"ח`)]));
  await expect(page.locator('#toast')).toContainText('Made 1 group from a label in names.');
  await goToTab(page, /^Me/);
  await page.getByRole('button', { name: /Look for patterns in names/ }).click();
  await expect(page.locator('#toast')).toContainText('New groups: 0. New suggestions: 2.');
  await expect(page.getByRole('tab', { name: /Me/ }).locator('.badge')).toHaveText('2');
});

test('"This is me" adds my Hebrew name, so relatives by surname are found and the card asks how', async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await onboard(page, 'Amitai Myers', '');
  await importVcf(page, vcfFile(['אמיתי מיירס', 'יוני מיירס', 'המפקד נדב']));
  await goToTab(page, /People/);
  await page.locator('#view-people li', { hasText: 'אמיתי מיירס' }).getByRole('button').click();
  await openSheet(page).getByRole('button', { name: 'This is me' }).click();
  await page.locator('#toast').getByRole('button', { name: 'Look' }).click();
  await page.locator('#toast').getByRole('button', { name: 'Review' }).click();

  const cards = openSheet(page);
  for (let i = 0; i < 2; i++) {
    await expect(cards.getByText(`${i + 1} of 2`)).toBeVisible(); // the previous card has flown away
    const asksHow = cards.getByRole('group', { name: 'How is יוני מיירס related to you?' });
    if (await asksHow.count()) {
      await expect(cards.getByRole('button', { name: 'Accept', exact: true })).toBeDisabled();
      await asksHow.getByText('My brother / sister').click();
    }
    await cards.getByRole('button', { name: 'Accept', exact: true }).click();
  }
  await expect(cards.getByRole('heading', { name: 'All reviewed!' })).toBeVisible();
  await cards.getByRole('button', { name: 'Done' }).click();
  await goToTab(page, /People/);
  await expect(page.locator('#view-people li', { hasText: 'יוני מיירס' }).locator('.tag')).toHaveText('sibling');
  await expect(page.locator('#view-people li', { hasText: 'אמיתי מיירס' })).toHaveCount(0);
});

test('an iPhone WhatsApp export (.zip) imports the group, and people already here join it', async ({ page }) => {
  await onboard(page, 'Amitai', '');
  await importVcf(page, 'family.vcf'); // includes Sarah Cohen
  await goToTab(page, /^Me/);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /WhatsApp chat/ }).click();
  const zip = readFileSync(fixture('whatsapp-iphone.zip'));
  await (await chooser).setFiles({ name: 'WhatsApp Chat - 108 משפחה.zip', mimeType: 'application/zip', buffer: zip });

  const review = openSheet(page);
  await expect(review.getByRole('heading', { name: 'Who should come in?' })).toBeVisible();
  await expect(review.getByRole('textbox', { name: 'Group name' })).toHaveValue('108 משפחה');
  await expect(review.getByText('People already in your graph join the group and get the link too.')).toBeVisible();
  await review.getByRole('combobox', { name: 'How do you know them?' }).selectOption('army');
  await expect(review.getByRole('checkbox', { name: 'Sarah Cohen' })).not.toBeChecked(); // already here
  await expect(review.locator('li')).toHaveCount(5); // no "You", no group pseudo-sender
  await review.getByRole('button', { name: 'Import 4' }).click();
  await expect(page.locator('#toast')).toContainText('Added 4 people. Linked 5 people to you.');
  // "המפקד חגי" is already linked as army: no duplicate suggestion for him.
  await expect(page.locator('#toast')).not.toContainText('possible connection');

  await goToTab(page, /People/);
  await page.locator('#view-people li', { hasText: 'Sarah Cohen' }).getByRole('button').click();
  await expect(openSheet(page).getByRole('button', { name: '108 משפחה' })).toHaveAttribute('aria-pressed', 'true');
  await expect(openSheet(page).locator('.list-row', { hasText: 'Amitai' }).locator('.tag')).toHaveText('army / sherut friend');
});

test('reopening the app draws the graph even when "me" is not first in storage', async ({ page }) => {
  // Storage returns people sorted by random id; with 20 linked people some sort before "me".
  await onboard(page, 'Amitai', '');
  const chooser = page.waitForEvent('filechooser');
  await openSheet(page).getByRole('button', { name: /Contacts file/ }).click();
  // Distinct names: a shared word ("Friend 1", "Friend 2"…) would become a group, and grouped people are not anchored to me.
  await (await chooser).setFiles(vcfFile(Array.from({ length: 20 }, (_, i) => `Pal${i}x Q${i}z`)));
  const review = openSheet(page);
  await review.getByRole('combobox', { name: 'How do you know them?' }).selectOption('friend');
  await review.getByRole('button', { name: 'Import 20' }).click();
  await expect(page.locator('#toast')).toContainText('Linked 20 people to you.');

  await page.reload();
  await expect(page.getByRole('tab', { name: /Graph/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.graph-a11y [data-person]')).toHaveCount(21);
  await page.waitForTimeout(500);
  await expect(page.locator('#toast')).not.toContainText('Something went wrong');
});
