import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { goToTab, importVcf, onboard, openSheet } from './helpers';

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
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
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
