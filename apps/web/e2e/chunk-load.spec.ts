import { test, expect } from '@playwright/test';
import { authenticate, createProject, msg } from './helpers';

// A view's code is fetched when the view is first opened; when the fetch fails, the message says
// that rather than blaming the document, and the way out is a reload.
test('a view whose chunk fails to load says so, and reload brings it back', async ({ page }) => {
  await authenticate(page);
  await createProject(page, `E2E Chunk ${Date.now()}`);
  await page.getByRole('button', { name: 'Save' }).click(); // a saved spec, so Mock has a catalog to show
  await expect(page.getByText(msg('saved', { version: 1 }))).toBeVisible();

  await page.getByLabel('Title').fill('Edited, unsaved'); // the reload would take this with it

  await page.route('**/MockView.tsx*', (route) => route.abort());
  await page.getByRole('button', { name: 'Mock', exact: true }).click();
  await expect(page.getByText(msg('viewUnloadedTitle'))).toBeVisible();

  // Reload asks first, in the app's own dialog; the edit is still there to go back and save.
  await page.getByRole('button', { name: msg('reload') }).click();
  await expect(page.getByText(msg('unsavedLeave'))).toBeVisible();
  await page.getByLabel('confirm-cancel').click();
  await page.getByRole('button', { name: 'Design', exact: true }).click();
  await expect(page.getByLabel('Title')).toHaveValue('Edited, unsaved');

  await page.unroute('**/MockView.tsx*');
  await page.getByRole('button', { name: 'Mock', exact: true }).click();
  await page.getByRole('button', { name: msg('reload') }).click();
  await page.getByLabel('confirm-ok').click();
  await expect(page.getByLabel('mock-filter')).toBeVisible();
});
