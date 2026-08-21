import { test, expect } from '@playwright/test';
import { authenticate, createProject, msg } from './helpers';

// Restore is append-only: the restored content lands as a NEW version on top (the ledger never
// rewinds), and the editor reloads onto it.
test('restoring v1 brings its content back as a new version on top', async ({ page }) => {
  const name = `Restore ${Date.now()}`;
  await authenticate(page);
  await createProject(page, name);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(msg('saved', { version: 1 }))).toBeVisible();

  // v2: retitle the API (the starter seeded v1's title with the project name).
  await page.getByLabel('Title').fill('Second Draft');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(msg('saved', { version: 2 }))).toBeVisible();

  // History: pick v1 — only a version behind the head offers the restore button.
  await page.getByLabel('tool-history').click();
  await page.getByRole('button', { name: /^v1 / }).click();
  await page.getByRole('button', { name: msg('restoreTo', { v: 1 }) }).click();
  await page.getByLabel('confirm-ok').click();

  // v3 appears, marked as restored from v1 — and v2 stays in history untouched.
  const v3row = page.getByRole('button', { name: /^v3 / });
  await expect(v3row).toContainText(msg('authorRestore', { v: 1 }));
  await expect(page.getByRole('button', { name: /^v2 / })).toBeVisible();

  // The editor reloaded onto the new head: v3 is "current", the title is v1's again, and there
  // is nothing unsaved — a restore is a server-side write, not a local edit.
  await expect(v3row).toContainText(msg('current'));
  await expect(page.getByLabel('Title')).toHaveValue(name);
  await expect(page.getByLabel('unsaved')).toBeHidden();
});
