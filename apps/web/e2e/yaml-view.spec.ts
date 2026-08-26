import { test, expect } from '@playwright/test';
import { authenticate, msg } from './helpers';

/** A spec big enough that a render trails a keystroke — the window the old controlled editor lost text in. */
function bigSpec(paths: number): string {
  const lines = ['openapi: 3.1.0', 'info: { title: Big, version: 1.0.0 }', 'paths:'];
  for (let i = 0; i < paths; i++) {
    lines.push(`  /things/${i}:`, '    get:', `      summary: Thing ${i}`, '      description: |');
    for (let j = 0; j < 6; j++) lines.push(`        line ${j} of a long description for thing ${i}`);
    lines.push("      responses: { '200': { description: ok } }");
  }
  return lines.join('\n') + '\n';
}

// The YAML editor is uncontrolled: while a burst of keystrokes is in flight, the text prop trails
// the editor, and a controlled Monaco would "correct" the editor back to it — text lost, cursor
// thrown to the end of the document.
test('a burst of typing in the YAML view loses nothing and keeps the cursor', async ({ page }) => {
  await authenticate(page);
  await page.getByLabel('New project', { exact: true }).click();
  await page.getByLabel('import-new-file').setInputFiles({
    name: 'big.yaml',
    mimeType: 'application/yaml',
    buffer: Buffer.from(bigSpec(400)),
  });
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByLabel('Title')).toHaveValue('Big', { timeout: 15000 });

  await page.getByRole('button', { name: 'YAML', exact: true }).click();
  const editor = page.locator('.monaco-editor').first();
  await expect(editor).toBeVisible();
  // Reveal puts the cursor on the `/things/0:` key; two lines down is its summary.
  await page.getByLabel('open-op-get-/things/0').click();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('End');
  const burst = 'abcdefghijklmnopqrstuvwxyz0123456789';
  await page.keyboard.type(burst, { delay: 0 });

  // Save and read the file back: the editor's model is not reachable from the page, and the
  // saved text is what matters anyway.
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(msg('saved', { version: 2 }))).toBeVisible({ timeout: 15000 });
  const projectId = new URL(page.url()).pathname.split('/')[2];
  const tok = await page.evaluate(() => localStorage.getItem('apione-token'));
  const r = await page.request.get(`/api/projects/${projectId}/files/openapi.yaml`, {
    headers: { Authorization: `Bearer ${tok}` },
  });
  const content = (await r.json()).content as string;
  expect(content).toContain(`summary: Thing 0${burst}`);
  // Nothing spilled to the end of the document either.
  expect(content.split('\n').slice(-3).join('\n')).not.toContain(burst.slice(-6));
});

// Text that arrives from outside the editor (a restore here) still replaces what it shows.
test('a restore while the YAML view is open updates the text', async ({ page }) => {
  await authenticate(page);
  await page.getByLabel('New project', { exact: true }).click();
  await page.getByPlaceholder(/Project name/).fill(`Yaml restore ${Date.now()}`);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText(msg('emptyProject'))).toBeVisible();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(msg('saved', { version: 1 }))).toBeVisible();
  await page.getByLabel('Title').fill('Second Draft');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(msg('saved', { version: 2 }))).toBeVisible();

  await page.getByRole('button', { name: 'YAML', exact: true }).click();
  await expect(page.locator('.monaco-editor').first()).toContainText('Second Draft');

  await page.getByLabel('tool-history').click();
  await page.getByRole('button', { name: /^v1 / }).click();
  await page.getByRole('button', { name: msg('restoreTo', { v: 1 }) }).click();
  await page.getByLabel('confirm-ok').click();
  await expect(page.locator('.monaco-editor').first()).not.toContainText('Second Draft');
});
