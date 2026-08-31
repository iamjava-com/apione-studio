import { test, expect } from '@playwright/test';
import { addEndpoint, authenticate, createProject, msg } from './helpers';

// The history panel lists what changed between two versions per endpoint — the semantic
// changelog from oasdiff — with the text diff behind a toggle.
test('history lists the endpoint a save added, and can switch to the text diff', async ({ page }) => {
  await authenticate(page);
  await createProject(page, `Changelog ${Date.now()}`);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(msg('saved', { version: 1 }))).toBeVisible();

  await addEndpoint(page, 'post', '/orders');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(msg('saved', { version: 2 }))).toBeVisible();

  await page.getByLabel('tool-history').click();
  await expect(page.getByLabel('compare-base')).toBeVisible();
  const row = page.getByLabel('change-POST /orders');
  await expect(row).toBeVisible();
  await expect(row).toContainText(msg('changeAdded'));
  await row.click();
  // An addition breaks nobody; what shows is the diff of just that endpoint — its lines, none of
  // the rest of the file — under the no-breaking line.
  await expect(page.getByText(msg('breakingNone')).first()).toBeVisible();
  await expect(page.getByText('responses:').first()).toBeVisible();
  await expect(page.getByText('/hello:')).toHaveCount(0);

  // The text diff is still there, one click away.
  await page.getByRole('button', { name: msg('showFileDiff') }).click();
  await expect(page.getByText('/orders:').first()).toBeVisible();
  await page.getByRole('button', { name: msg('showChanges') }).click();
  await expect(row).toBeVisible();
});

// Deleting an endpoint is a breaking change: its row opens to the error count, and the count
// floats oasdiff's own words.
test('a removed endpoint opens to its breaking summary', async ({ page }) => {
  await authenticate(page);
  await createProject(page, `Removed ${Date.now()}`);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(msg('saved', { version: 1 }))).toBeVisible();

  await page.getByRole('group', { name: 'path-/hello' }).hover();
  await page.getByLabel('delete-op').click();
  await page.getByLabel('confirm-ok').click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(msg('saved', { version: 2 }))).toBeVisible();

  await page.getByLabel('tool-history').click();
  const row = page.getByLabel('change-GET /hello');
  await expect(row).toContainText(msg('changeRemoved'));
  await row.click();
  await page.getByRole('button', { name: msg('errors', { count: 1 }), exact: false }).click();
  await expect(page.getByText('api path removed', { exact: false })).toBeVisible();
});
