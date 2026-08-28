import { test, expect, type Page } from '@playwright/test';
import { authenticate, createProject, msg } from './helpers';

// Monaco auto-indents after Enter; select that indentation away before typing the next line.
async function setYaml(page: Page, text: string) {
  await page.locator('.monaco-editor').first().click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Delete');
  for (const line of text.replace(/\n$/, '').split('\n')) {
    await page.keyboard.type(line);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Shift+Home');
  }
  await page.keyboard.press('Delete');
}

test('edits travel both ways between the form and the YAML view', async ({ page }) => {
  await authenticate(page);
  await createProject(page, `Modes ${Date.now()}`);
  await page.getByLabel('Title').fill('From the form');
  await page.getByLabel('Title').press('Tab');

  await page.getByRole('button', { name: 'YAML', exact: true }).click();
  const editor = page.locator('.monaco-editor').first();
  await expect(editor).toContainText('From the form');

  // Edit the text: retitle again from the YAML side.
  await setYaml(
    page,
    'openapi: 3.1.0\ninfo:\n  title: From the text\n  version: 1.0.0\npaths:\n  /hello:\n    get:\n      responses:\n        "200":\n          description: ok\n',
  );
  await page.getByRole('button', { name: 'Form', exact: true }).click();
  await expect(page.getByLabel('Title')).toHaveValue('From the text');
  await expect(page.getByLabel('unsaved')).toBeVisible();
});

test('switching views on a saved file does not make it unsaved', async ({ page }) => {
  await authenticate(page);
  await createProject(page, `Modes clean ${Date.now()}`);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(msg('saved', { version: 1 }))).toBeVisible();

  // Both conversions must reproduce the saved bytes: the form serializes what the server wrote.
  await page.getByRole('button', { name: 'YAML', exact: true }).click();
  await expect(page.locator('.monaco-editor').first()).toBeVisible();
  await expect(page.getByLabel('unsaved')).toBeHidden();
  await page.getByRole('button', { name: 'Form', exact: true }).click();
  await expect(page.getByLabel('Title')).toBeVisible();
  await expect(page.getByLabel('unsaved')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
});

test('text that does not parse keeps the form off until it is fixed', async ({ page }) => {
  await authenticate(page);
  await createProject(page, `Modes broken ${Date.now()}`);
  await page.getByRole('button', { name: 'YAML', exact: true }).click();
  const editor = page.locator('.monaco-editor').first();
  await setYaml(page, 'openapi: 3.1.0\ninfo: [unclosed\n');

  await page.getByRole('button', { name: 'Form', exact: true }).click();
  await expect(page.getByText(msg('formUnavailable'))).toBeVisible();

  // Back to the text — it is still the broken text, not a stale doc — and fix it.
  await page.getByRole('button', { name: 'YAML', exact: true }).click();
  await expect(editor).toContainText('[unclosed');
  await setYaml(page, 'openapi: 3.1.0\ninfo:\n  title: Fixed\n  version: 1.0.0\npaths: {}\n');
  await page.getByRole('button', { name: 'Form', exact: true }).click();
  await expect(page.getByLabel('Title')).toHaveValue('Fixed');
});
