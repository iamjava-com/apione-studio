import { test, expect } from '@playwright/test';
import { authenticate, createProject, msg } from './helpers';

// Two independently generated versions — same endpoints, every one written differently (a YApi
// migration next to a Swagger 2 import) — are the worst case for a line diff, and a large one used
// to freeze the tab. The diff runs in a worker: this checks the wiring, not the speed.
test('history diffs two differently written versions off the main thread', async ({ page }) => {
  await authenticate(page);
  await createProject(page, `Big diff ${Date.now()}`);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(msg('saved', { version: 1 }))).toBeVisible();
  const projectId = new URL(page.url()).pathname.split('/')[2];

  const spec = (alt: boolean) => {
    const op = (i: number) =>
      alt
        ? `    get:\n      tags:\n        - items\n      summary: Item ${i}\n      operationId: op${i}\n      parameters:\n        - name: Authorization\n          in: header\n          schema:\n            type: string\n      responses:\n        '200':\n          description: successful operation\n          content:\n            '*/*':\n              schema:\n                type: object\n                properties:\n                  id:\n                    type: integer\n                  name:\n                    type: string\n`
        : `    get:\n      operationId: op${i}\n      summary: Item ${i}\n      responses:\n        '200':\n          description: ok\n          content:\n            application/json:\n              schema:\n                type: object\n                properties:\n                  id:\n                    type: integer\n                  name:\n                    type: string\n      security:\n        - be: []\n`;
    const paths = [...Array(200).keys()].map((i) => `  /r${i}:\n${op(i)}`).join('');
    return `openapi: 3.1.0\ninfo:\n  title: Big\n  version: 1.0.0\npaths:\n${paths}`;
  };
  const tok = await page.evaluate(() => localStorage.getItem('apione-token'));
  const headers = { Authorization: `Bearer ${tok}` };
  const url = `/api/projects/${projectId}/files/openapi.yaml`;
  for (const [v, content] of [
    [1, spec(false)],
    [2, spec(true)],
  ] as const) {
    const res = await page.request.put(url, { headers, data: { content, baseVersion: v } });
    expect(res.ok()).toBeTruthy();
  }
  await page.reload();
  await expect(page.getByLabel('Title')).toHaveValue('Big');

  // History defaults to head vs the version before it: v3 vs v2.
  await page.getByLabel('tool-history').click();
  await expect(page.getByLabel('compare-base')).toBeVisible();
  await expect(page.getByText('/r0:').first()).toBeVisible();
  await expect(page.getByText('successful operation').first()).toBeVisible();
});
