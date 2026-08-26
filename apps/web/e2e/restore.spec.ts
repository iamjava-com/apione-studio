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

// Opening the inspect panel must not remount the workspace (that re-parses the spec and freezes the
// tab on a large one). The YAML view is editor state, so it survives only if the editor did.
test('opening history leaves the editor as it was', async ({ page }) => {
  await authenticate(page);
  await createProject(page, `History mount ${Date.now()}`);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(msg('saved', { version: 1 }))).toBeVisible();

  await page.getByRole('button', { name: 'YAML', exact: true }).click();
  await expect(page.locator('.monaco-editor').first()).toBeVisible();

  await page.getByLabel('tool-history').click();
  await expect(page.getByLabel('compare-base')).toBeVisible();
  await expect(page.locator('.monaco-editor').first()).toBeVisible();

  await page.getByLabel('close-tool').click();
  await expect(page.getByLabel('compare-base')).toBeHidden();
  await expect(page.locator('.monaco-editor').first()).toBeVisible();
});

// The panel cannot be dragged shut: that would close the tool mid-drag, and dragging back would
// reopen it empty. The divider stops at the panel's minimum.
test('the history panel cannot be dragged shut', async ({ page }) => {
  await authenticate(page);
  await createProject(page, `History drag ${Date.now()}`);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(msg('saved', { version: 1 }))).toBeVisible();
  await page.getByLabel('tool-history').click();
  await expect(page.getByLabel('compare-base')).toBeVisible();

  const panel = page.locator('[data-panel]').last();
  const sep = page.locator('[data-separator]').last();
  const box = (await sep.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 2000, box.y + box.height / 2, { steps: 10 });
  // Still down: drag back a little — this is where a collapsible panel would reopen empty.
  await page.mouse.move(box.x + 1900, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();

  await expect(page.getByLabel('compare-base')).toBeVisible();
  const group = (await page.locator('[data-group]').first().boundingBox())!;
  expect((await panel.boundingBox())!.width).toBeGreaterThanOrEqual(group.width * 0.16 - 1);

  // Closing still takes it to zero width, and reopening brings it back.
  await page.getByLabel('close-tool').click();
  await expect(page.getByLabel('compare-base')).toBeHidden();
  expect((await panel.boundingBox())!.width).toBeLessThan(1);
  await page.getByLabel('tool-history').click();
  await expect(page.getByLabel('compare-base')).toBeVisible();
  expect((await panel.boundingBox())!.width).toBeGreaterThanOrEqual(group.width * 0.16 - 1);
});
