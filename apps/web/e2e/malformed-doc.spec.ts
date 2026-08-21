import { test, expect } from '@playwright/test';
import { authenticate, createProject } from './helpers';

test('a malformed document does not take the workspace shell with it', async ({ page }) => {
  await authenticate(page);
  await createProject(page, `Broken ${Date.now()}`);

  // Shapes an import or a hand-edit can produce: fields the form walks expecting objects and
  // arrays, holding strings instead.
  await page.getByRole('button', { name: 'YAML', exact: true }).click();
  await page.locator('.monaco-editor').first().click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(
    'openapi: 3.1.0\ninfo:\n  title: T\n  version: "1"\npaths:\n  /x:\n    get:\n      parameters: oops\n      responses: nope\n',
  );
  await page.getByRole('button', { name: 'Form', exact: true }).click();

  // The form is expected to cope; the boundary around it is there for whatever it does not. Either
  // way the shell survives, so the YAML view is still reachable to fix the file in.
  await expect(page.getByRole('button', { name: 'YAML', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'YAML', exact: true }).click();
  await expect(page.locator('.monaco-editor').first()).toBeVisible();
});
