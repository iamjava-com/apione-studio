import { test, expect } from '@playwright/test';
import { addEndpoint, authenticate, createProject, msg } from './helpers';

// A mock leaves no trace in the document, so nothing about it moves the file's version — the view
// has to ask for it again on its own or it shows what was true when the tab was opened.
test('another author’s mock mode and code arrive when the selection changes', async ({ page }) => {
  await authenticate(page);
  await createProject(page, `Mock revisit ${Date.now()}`);
  await addEndpoint(page, 'get', '/orders');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByLabel('unsaved')).toHaveCount(0);

  const projectId = new URL(page.url()).pathname.split('/')[2];
  const tok = await page.evaluate(() => localStorage.getItem('apione-token'));
  const headers = { Authorization: `Bearer ${tok}` };
  const idOf = async (path: string) => {
    const listed = await (await page.request.get(`/api/projects/${projectId}/operations`, { headers })).json();
    return listed.operations.find((o: { path: string }) => o.path === path).opId as string;
  };

  // Ours: open the starter's mock and switch it to scripted, which caches its code here.
  await page.getByRole('button', { name: 'Mock', exact: true }).click();
  await page.getByText('Say hello').click();
  await page.getByRole('button', { name: 'Scripted', exact: true }).click();
  await expect(page.locator('.monaco-editor').first()).toContainText('MockResponse');

  // Theirs: rewrite that code, and put the other endpoint on scripted too.
  const hello = await idOf('/hello');
  const read = await (await page.request.get(`/api/projects/${projectId}/mock/code?opId=${hello}`, { headers })).json();
  const written = await page.request.put(`/api/projects/${projectId}/mock/code`, {
    headers,
    data: { opId: hello, content: '// theirs, not ours\n', baseVersion: read.version },
  });
  expect(written.ok()).toBeTruthy();
  await page.request.patch(`/api/projects/${projectId}/mock/mode`, {
    headers,
    data: { opId: await idOf('/orders'), mode: 'scripted' },
  });

  // Leaving the endpoint and coming back re-reads the code the cache was holding, and the catalog
  // that says the other endpoint is scripted now. (No assertion that it is still stale first — the
  // editor taking focus can itself count as a revisit, and that race is not what is under test.)
  const ordersRow = page.getByTitle('/orders', { exact: true });
  await ordersRow.click();
  await expect(ordersRow).toContainText('Scripted');
  await page.getByText('Say hello').click();
  await expect(page.locator('.monaco-editor').first()).toContainText('theirs, not ours');
});

// Mock code is a sidecar — no structure to merge on, so a concurrent write is a real conflict and
// has to be said in full, not squeezed into the toolbar.
test('a mock saved out from under you gets the conflict banner, and reload takes theirs', async ({ page }) => {
  await authenticate(page);
  await createProject(page, `Mock conflict ${Date.now()}`);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByLabel('unsaved')).toHaveCount(0);

  await page.getByRole('button', { name: 'Mock', exact: true }).click();
  await page.getByText('Say hello').click();
  await page.getByRole('button', { name: 'Scripted', exact: true }).click();
  await page.locator('.monaco-editor').first().click();
  await page.keyboard.type('// ours');
  await expect(page.getByLabel('unsaved')).toBeVisible();

  // Someone else writes the same mock while our edit is still unsaved.
  const projectId = new URL(page.url()).pathname.split('/')[2];
  const tok = await page.evaluate(() => localStorage.getItem('apione-token'));
  const headers = { Authorization: `Bearer ${tok}` };
  const listed = await (await page.request.get(`/api/projects/${projectId}/operations`, { headers })).json();
  const opId = listed.operations[0].opId;
  const read = await (await page.request.get(`/api/projects/${projectId}/mock/code?opId=${opId}`, { headers })).json();
  const written = await page.request.put(`/api/projects/${projectId}/mock/code`, {
    headers,
    data: { opId, content: '// theirs\n', baseVersion: read.version },
  });
  expect(written.ok()).toBeTruthy();

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const banner = page.getByLabel('mock-conflict');
  await expect(banner).toContainText(msg('mockConflict'));
  await expect(page.getByLabel('unsaved')).toBeVisible(); // refused, so the edit is still ours to keep

  // Reload is the way out, and it says what it costs before taking it.
  await banner.getByRole('button', { name: 'Reload' }).click();
  await page.getByLabel('confirm-ok').click();
  await expect(banner).toHaveCount(0);
  await expect(page.locator('.monaco-editor').first()).toContainText('theirs');
});

// A base path lives in `servers[].url`, so declaring one moves the endpoint — for the mock exactly
// as for the API it stands in for. Everything that shows or calls a mock address has to follow.
test('a declared server’s base path moves the mock address, and the docs follow', async ({ page }) => {
  await authenticate(page);
  await createProject(page, `Mock base ${Date.now()}`);

  await page.getByRole('button', { name: 'Info' }).click();
  await page.getByLabel('add-server').click();
  await page.getByLabel('server-url').fill('https://api.example.com/v1');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByLabel('unsaved')).toHaveCount(0);

  const projectId = new URL(page.url()).pathname.split('/')[2];
  await page.getByRole('button', { name: 'Mock', exact: true }).click();
  await page.getByText('Say hello').click();

  // One endpoint, one address — the panel says where the prefix came from rather than listing both.
  const urls = page.getByLabel('mock-urls').getByRole('listitem');
  await expect(urls).toHaveCount(1);
  await expect(urls.first()).toContainText(`/mock/${projectId}/v1/hello`);
  await expect(page.getByText(msg('mockUrlFromServers'))).toBeVisible();

  // (What the gateway serves — 200 behind the declared prefix, 404 off it — is covered by
  // apps/server/test/mock.test.ts; here only the panel and the docs are under test.)

  // The docs' Mock server has to move with it, or every "Send" in there is a 404.
  await page.getByText('Docs', { exact: true }).click();
  await expect(page.getByText(`/mock/${projectId}/v1`).first()).toBeVisible({ timeout: 15000 });

  // A second server at the root is a declaration too: it puts the bare address back, listed in the
  // order the two were written.
  await page.getByRole('button', { name: 'Design', exact: true }).click();
  await page.getByRole('button', { name: 'Info' }).click();
  await page.getByLabel('add-server').click();
  await page.getByLabel('server-url').last().fill('/');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByLabel('unsaved')).toHaveCount(0);

  await page.getByRole('button', { name: 'Mock', exact: true }).click();
  await page.getByText('Say hello').click();
  await expect(urls).toHaveCount(2);
  await expect(urls.first()).toContainText(`/mock/${projectId}/v1/hello`);
  await expect(urls.last()).toContainText(`/mock/${projectId}/hello`);
});

test('deleting an operation drops its mock draft, so leaving asks nothing', async ({ page }) => {
  await authenticate(page);
  await createProject(page, `Mock draft ${Date.now()}`);
  await page.getByRole('button', { name: 'Save' }).click(); // the starter only exists once written
  await expect(page.getByLabel('unsaved')).toHaveCount(0);

  // Author a scripted mock for the starter operation and leave the edit unsaved.
  await page.getByRole('button', { name: 'Mock', exact: true }).click();
  await page.getByText('Say hello').click();
  await page.getByRole('button', { name: 'Scripted', exact: true }).click(); // auto → scripted, saves the starter
  await page.locator('.monaco-editor').first().click();
  await page.keyboard.type('// unsaved draft');
  await expect(page.getByLabel('unsaved')).toBeVisible();

  // Delete the operation on the design canvas and save — the server takes its mock with it.
  await page.getByRole('button', { name: 'Design', exact: true }).click();
  await page
    .getByLabel('open-op-get-/hello')
    .locator('xpath=following-sibling::div//button[@aria-label="delete-op"]')
    .click();
  await page.getByLabel('confirm-ok').click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByLabel('unsaved')).toHaveCount(0);

  // The endpoint is gone from the Mock list, and so is the draft: leaving asks nothing.
  await page.getByRole('button', { name: 'Mock', exact: true }).click();
  await expect(page.getByText('Say hello')).toHaveCount(0);
  await page.getByLabel('Back to projects').click();
  await expect(page.getByLabel('confirm-ok')).toHaveCount(0);
  await expect(page.getByLabel('New project', { exact: true })).toBeVisible();
});

// Every revisit re-reads the mock, and a read replaces the state the revisit callback closes over.
// If that callback is rebuilt from the state it just changed, the two feed each other and the view
// reads forever.
test('the mock view stops reading once it has an answer', async ({ page }) => {
  await authenticate(page);
  await createProject(page, `Mock idle ${Date.now()}`);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByLabel('unsaved')).toHaveCount(0);

  await page.getByRole('button', { name: 'Mock', exact: true }).click();

  let reads = 0;
  page.on('request', (r) => {
    if (/^\/api\/projects\/[^/]+\/mock/.test(new URL(r.url()).pathname)) reads += 1;
  });

  await page.getByText('Say hello').click();
  await expect(page.getByText('Auto mock is serving this endpoint')).toBeVisible();
  await page.waitForTimeout(2000);

  // Selecting the endpoint costs its code plus one catalog re-read; nothing after that.
  expect(reads).toBeLessThanOrEqual(4);
});
