import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { authenticate, createProject } from './helpers';

/**
 * The HTML export promises one thing: this file opens anywhere, offline, and reaches nothing.
 * The only way to know that is to open the file it actually produces — a server-side assertion
 * can confirm the configuration but not what a browser does with it. An earlier version of this
 * export passed every server-side check while quietly fetching webfonts from a third party on
 * every open.
 */
test('the exported page opens from disk and requests nothing', async ({ page, context }) => {
  await authenticate(page);
  await createProject(page, `Export ${Date.now()}`);
  await page.getByRole('button', { name: 'Save' }).click(); // the starter spec must exist to render

  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Export .html' }).click(),
  ]);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'apione-e2e-html-')), 'spec.html');
  await download.saveAs(file);

  // A second page, opened over file:// — the origin is `null`, exactly as on a recipient's machine.
  const offline = await context.newPage();
  const offsite: string[] = [];
  offline.on('request', (r) => {
    if (!r.url().startsWith('file://')) offsite.push(r.url());
  });
  await offline.goto(`file://${file}`);
  await expect(offline.locator('#api-reference')).toHaveCount(1);
  await expect(offline.getByRole('heading', { level: 1 }).first()).toBeVisible(); // it rendered
  expect(offsite, 'nothing may be fetched when the file is opened').toEqual([]);

  // Live-request entry points are gone: from file:// they are blocked by CORS, and Scalar's
  // fallback would relay the reader's request — auth headers included — through its own proxy.
  await expect(offline.getByRole('button', { name: /Test Request/i })).toBeHidden();
  await expect(offline.getByRole('button', { name: /Close Client/i })).toBeHidden();
});
