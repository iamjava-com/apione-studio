import { test, expect, type Page } from '@playwright/test';
import { authenticate, createProject, msg, otherAuthorWrites } from './helpers';

const otherAuthorAdds = (page: Page, projectId: string, opPath: string) =>
  otherAuthorWrites(page, projectId, (c) =>
    c.replace(
      /^paths:$/m,
      `paths:\n  ${opPath}:\n    get:\n      responses:\n        '200':\n          description: ok`,
    ),
  );

// Onto /hello's get, which is where these tests put their own edits too.
const otherAuthorSets = (page: Page, projectId: string, line: string) =>
  otherAuthorWrites(page, projectId, (c) => c.replace(/^ {4}get:$/m, `    get:\n      ${line}`));

async function newSavedProject(page: Page, name: string) {
  await createProject(page, name);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(msg('saved', { version: 1 }))).toBeVisible();
  return new URL(page.url()).pathname.split('/')[2];
}

test('an editor with nothing unsaved picks up a co-author’s operations', async ({ page }) => {
  await authenticate(page);
  const projectId = await newSavedProject(page, `Stale ${Date.now()}`);

  await page.getByLabel('open-op-get-/hello').click();
  await otherAuthorAdds(page, projectId, '/orders');
  await expect(page.getByLabel('open-op-get-/orders')).toBeHidden(); // nothing has asked yet

  await page.getByRole('button', { name: 'Info' }).click();
  await expect(page.getByLabel('open-op-get-/orders')).toBeVisible();
});

test('unsaved edits are replayed on top of a co-author’s save, silently', async ({ page }) => {
  await authenticate(page);
  const projectId = await newSavedProject(page, `Stale dirty ${Date.now()}`);

  await page.getByLabel('open-op-get-/hello').click();
  await page.getByLabel('op-description').fill('Mine, unsaved.');
  await page.getByLabel('op-description').blur();
  await expect(page.getByLabel('unsaved')).toBeVisible();

  await otherAuthorAdds(page, projectId, '/pets');
  await page.getByRole('button', { name: 'Info' }).click();

  // Both sides, no prompt: their endpoint arrives, the edit is still unsaved and still ours.
  await expect(page.getByLabel('open-op-get-/pets')).toBeVisible();
  await expect(page.getByLabel('unsaved')).toBeVisible();
  await expect(page.getByText('v2', { exact: true })).toBeVisible(); // rebased onto their version
  await page.getByLabel('open-op-get-/hello').click();
  await expect(page.getByLabel('op-description')).toHaveValue('Mine, unsaved.');

  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(msg('saved', { version: 3 }))).toBeVisible();
  await expect(page.getByLabel('open-op-get-/pets')).toBeVisible();
  await expect(page.getByLabel('op-description')).toHaveValue('Mine, unsaved.');
});

test('an edit to the very thing a co-author changed raises the conflict banner', async ({ page }) => {
  await authenticate(page);
  const projectId = await newSavedProject(page, `Stale overlap ${Date.now()}`);

  await page.getByLabel('open-op-get-/hello').click();
  await page.getByLabel('op-description').fill('Mine.');
  await page.getByLabel('op-description').blur();

  // The same field, a different value — the one thing the merge cannot decide.
  await otherAuthorSets(page, projectId, 'description: Theirs.');
  await page.getByRole('button', { name: 'Info' }).click();

  await expect(page.getByText(msg('conflict', { version: 2 }))).toBeVisible();
  await page.getByLabel('open-op-get-/hello').click();
  await expect(page.getByLabel('op-description')).toHaveValue('Mine.'); // told, not overwritten
});
