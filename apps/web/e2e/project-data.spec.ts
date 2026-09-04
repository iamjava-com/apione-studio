import { test, expect } from '@playwright/test';
import { authenticate, createProject, msg } from './helpers';

// The project's derived reads can each fail on their own; what that means is decided where it shows.

const fail = (status: number) => ({ status, contentType: 'application/json', body: '{"error":"boom"}' });

test('a failed project read leaves an editor on the design canvas', async ({ page }) => {
  await authenticate(page);
  // The detail read only — the list and the files underneath keep answering.
  await page.route(/\/api\/projects\/[^/?]+$/, (route) =>
    route.request().method() === 'GET' ? route.fulfill(fail(500)) : route.continue(),
  );
  await createProject(page, `E2E Perms ${Date.now()}`);
  await expect(page.getByLabel('add-endpoint')).toBeVisible();
  await expect(page.getByLabel('Title')).toBeEditable();
});

test('a never-saved project’s Mock tab asks for a save, not for patience', async ({ page }) => {
  await authenticate(page);
  await createProject(page, `E2E No Spec ${Date.now()}`);

  await page.getByRole('button', { name: 'Mock', exact: true }).click();
  await expect(page.getByText(msg('mockNoSpec'))).toBeVisible();
});

test('a failed mock catalog read says so instead of waiting', async ({ page }) => {
  await authenticate(page);
  await createProject(page, `E2E Catalog ${Date.now()}`);
  await page.route('**/api/projects/*/mock', (route) => route.fulfill(fail(500)));

  await page.getByRole('button', { name: 'Mock', exact: true }).click();
  await expect(page.getByText(msg('mockCatalogFailed'))).toBeVisible();
});

test('a failed lint read shows no chip rather than a false one', async ({ page }) => {
  await authenticate(page);
  await page.route('**/api/projects/*/lint', (route) => route.fulfill(fail(500)));
  await createProject(page, `E2E Lint ${Date.now()}`);
  await expect(page.getByLabel('add-endpoint')).toBeVisible();
  await expect(page.getByLabel('lint-status')).toHaveCount(0);
});
