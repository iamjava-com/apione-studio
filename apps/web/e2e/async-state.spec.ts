import { test, expect } from '@playwright/test';
import { authenticate, createProject, msg, otherAuthorWrites } from './helpers';

// What a failed or late read means is decided where it is shown, not by the read itself.

test('a forbidden members read says owner access is required, not that nobody is on the project', async ({ page }) => {
  await authenticate(page);
  await createProject(page, `E2E Denied ${Date.now()}`);
  await page.route('**/api/projects/*/members', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"forbidden"}' })
      : route.continue(),
  );

  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Members' }).click();
  await expect(dialog.getByText(msg('needOwner'))).toBeVisible();
});

test('a conflict’s "view diff" compares against my base, not the previous version', async ({ page }) => {
  await authenticate(page);
  await createProject(page, `E2E Focus ${Date.now()}`);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(msg('saved', { version: 1 }))).toBeVisible();
  const projectId = new URL(page.url()).pathname.split('/')[2]!;

  await page.getByLabel('open-op-get-/hello').click();
  await page.getByLabel('op-description').fill('Mine.');
  await page.getByLabel('op-description').blur();

  // Two co-author saves (v2, v3) while my edit is unsaved; the first touches the same field.
  await otherAuthorWrites(page, projectId, (c) => c.replace(/^ {4}get:$/m, '    get:\n      description: Theirs.'));
  await otherAuthorWrites(page, projectId, (c) => c.replace(/^ {4}get:$/m, '    get:\n      deprecated: true'));
  await page.getByRole('button', { name: 'Info' }).click();
  await expect(page.getByText(msg('conflict', { version: 3 }))).toBeVisible();

  // The version list's own default would be v2 → v3; the request from the banner wins.
  await page.getByRole('button', { name: msg('viewDiff') }).click();
  await expect(page.getByLabel('compare-base')).toHaveValue('1');
  await expect(page.getByText('v1 → v3')).toBeVisible();
});

test('a failed docs export shows the empty state', async ({ page }) => {
  await authenticate(page);
  await createProject(page, `E2E Docs Fail ${Date.now()}`);
  await page.route('**/api/projects/*/spec.json*', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }),
  );

  await page.getByText('Docs', { exact: true }).click();
  await expect(page.getByText(msg('docsEmptyTitle'))).toBeVisible();
});
