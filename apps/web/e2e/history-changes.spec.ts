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
  await expect(page.getByText('endpoint-added')).toBeVisible();

  // The text diff is still there, one click away.
  await page.getByRole('button', { name: msg('showFileDiff') }).click();
  await expect(page.getByText('/orders:').first()).toBeVisible();
  await page.getByRole('button', { name: msg('showChanges') }).click();
  await expect(row).toBeVisible();
});
