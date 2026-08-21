import { test, expect } from '@playwright/test';
import { addEndpoint, authenticate, createProject, msg } from './helpers';

/**
 * A stage is the one thing on the design canvas that is not in the document: it saves on change,
 * outside the save bar, and it survives a reload without anything being written to the file. Both
 * halves of that are only observable through the real app.
 */

/** A project with two saved endpoints — saved, because a stage needs the id a save mints. */
async function projectWithTwoEndpoints(page: import('@playwright/test').Page) {
  const name = `Stage ${Date.now()}`;
  await authenticate(page);
  await createProject(page, name);

  for (const path of ['/orders', '/drafts']) {
    await addEndpoint(page, 'get', path);
  }
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(msg('saved', { version: 1 }))).toBeVisible();
  return name;
}

test('a stage is set on the endpoint, shows in the outline, and outlives a reload', async ({ page }) => {
  await projectWithTwoEndpoints(page);

  await page.getByLabel('open-op-get-/orders').click();
  const picker = page.getByLabel('op-stage');
  await expect(picker).toBeEnabled();
  await expect(picker).toHaveValue('design');
  await picker.selectOption('released');

  // The outline row's dot follows the picker — the two read the same store, not two copies.
  const row = page.getByLabel('open-op-get-/orders');
  await expect(row.locator('[aria-label="stage-released"]')).toBeVisible();
  await expect(page.getByLabel('open-op-get-/drafts').locator('[aria-label="stage-design"]')).toBeVisible();

  // No document changed, so there is nothing to save — and after a reload the stage is still there,
  // which is what proves it was persisted rather than held in the page.
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
  await page.reload();
  await page.getByLabel('open-op-get-/orders').click();
  await expect(page.getByLabel('op-stage')).toHaveValue('released');
});

test('an endpoint can be staged before it has ever been saved', async ({ page }) => {
  await projectWithTwoEndpoints(page);

  await addEndpoint(page, 'get', '/fresh');

  // No id yet — the picker mints one into the document rather than making the author save first.
  await page.getByLabel('op-stage').selectOption('developing');
  await expect(page.getByLabel('open-op-get-/fresh').locator('[aria-label="stage-developing"]')).toBeVisible();

  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(msg('saved', { version: 2 }))).toBeVisible();

  // The save carried the minted id, so the stage set beforehand is still the one attached to it.
  await page.reload();
  await page.getByLabel('open-op-get-/fresh').click();
  await expect(page.getByLabel('op-stage')).toHaveValue('developing');
});

// A stage is not in the document, so nothing about it moves the file's version — the editor has
// to ask for it separately or it shows last hour's board forever.
test('a stage another author set arrives when the selection changes', async ({ page }) => {
  await projectWithTwoEndpoints(page);
  const projectId = new URL(page.url()).pathname.split('/')[2];
  const tok = await page.evaluate(() => localStorage.getItem('apione-token'));
  const headers = { Authorization: `Bearer ${tok}` };

  const listed = await (await page.request.get(`/api/projects/${projectId}/operations`, { headers })).json();
  const orders = listed.operations.find((o: { path: string }) => o.path === '/orders');
  const res = await page.request.patch(`/api/projects/${projectId}/operations/${orders.opId}/status`, {
    headers,
    data: { stage: 'released' },
  });
  expect(res.ok()).toBeTruthy();

  const row = page.getByLabel('open-op-get-/orders');
  await expect(row.locator('[aria-label="stage-design"]')).toBeVisible(); // nothing has asked yet
  await page.getByRole('button', { name: 'Info' }).click();
  await expect(row.locator('[aria-label="stage-released"]')).toBeVisible();
});

test('a duplicated endpoint does not inherit the original’s stage', async ({ page }) => {
  await projectWithTwoEndpoints(page);

  await page.getByLabel('open-op-get-/orders').click();
  await page.getByLabel('op-stage').selectOption('released');

  await page.getByLabel('open-op-get-/orders').hover();
  await page.getByLabel('duplicate-op').first().click();
  await expect(page.getByLabel('op-stage')).toHaveValue('design');
});

test('the released-only export leaves the unreleased endpoints out', async ({ page }) => {
  await projectWithTwoEndpoints(page);

  await page.getByLabel('open-op-get-/orders').click();
  await page.getByLabel('op-stage').selectOption('released');
  await expect(page.getByLabel('open-op-get-/orders').locator('[aria-label="stage-released"]')).toBeVisible();

  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();
  await dialog.getByLabel(/Exclude unreleased endpoints/).check();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Export .yaml' }).click(),
  ]);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  const yaml = Buffer.concat(chunks).toString('utf8');

  expect(yaml).toContain('/orders');
  expect(yaml).not.toContain('/drafts');
});
