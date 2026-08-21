import { test, expect } from '@playwright/test';
import { authenticate } from './helpers';

// API tokens from the account menu: mint one, capture the plaintext (shown once), revoke it.
test('api tokens: create, see the secret once, revoke', async ({ page }) => {
  await authenticate(page);
  await page.getByText('@admin').hover(); // reveal the account menu
  await page.getByRole('button', { name: 'API Token' }).click();
  await expect(page.getByLabel('token-name')).toBeVisible();

  const name = `ci${Date.now()}`;
  await page.getByLabel('token-name').fill(name);
  await page.getByRole('button', { name: 'Create' }).click();

  // This is the only place the plaintext ever exists — the server stores a hash and cannot reissue it.
  await expect(page.getByLabel('issued-token')).toHaveText(/^apione_\S+$/);
  const row = page.locator('li', { hasText: name });
  await expect(row).toBeVisible();
  await expect(row.getByText('never used')).toBeVisible();

  // While the secret is up, the backdrop is inert — a stray click there costs a re-issue.
  await page.mouse.click(5, 5);
  await expect(page.getByLabel('issued-token')).toBeVisible();

  // Revoking the one just minted takes its (now useless) secret off screen with it.
  await page.getByLabel(`revoke-${name}`).click();
  await page.getByLabel('confirm-ok').click();
  await expect(page.locator('li', { hasText: name })).toHaveCount(0);
  await expect(page.getByLabel('issued-token')).toHaveCount(0);

  // With nothing left to lose, the backdrop dismisses again.
  await page.mouse.click(5, 5);
  await expect(page.getByLabel('token-name')).toHaveCount(0);
});

// Same dialog: the instruction sends an agent here, and here is where it gets the token it asks
// for. Its URL is this instance's, so a self-hosted deployment can't hand out someone else's.
test('install skill: the copyable line sits with the tokens and targets this origin', async ({ page }) => {
  await authenticate(page);
  await page.getByText('@admin').hover();
  await page.getByRole('button', { name: 'API Token' }).click();
  await expect(page.getByLabel('skill-instruction')).toContainText(`${new URL(page.url()).origin}/docs/setup.md`);
  await expect(page.getByLabel('copy-instruction')).toBeVisible();
  await expect(page.getByLabel('token-name')).toBeVisible();
});

/** Unlike the exported spec.html, this page renders on the app's own origin, under a CSP that
 *  allows `script-src 'self'` — an inlined engine would leave it blank, and only a browser can
 *  tell us it didn't. */
test('api reference: linked from the token dialog, and it renders under the app CSP', async ({ page, context }) => {
  await authenticate(page);
  await page.getByText('@admin').hover();
  await page.getByRole('button', { name: 'API Token' }).click();

  const link = page.getByRole('link', { name: 'API reference' });
  await expect(link).toHaveAttribute('href', '/docs');

  const blocked: string[] = [];
  const docs = await context.newPage();
  docs.on('console', (m) => /Content Security Policy/i.test(m.text()) && blocked.push(m.text()));
  await docs.goto(new URL('/docs', page.url()).href);

  // The title is the fetched document's own `info.title` — nothing is baked into the page.
  await expect(docs.getByRole('heading', { name: 'ApiOne Studio API' }).first()).toBeVisible();
  // The document is reachable here, unlike in the exported file, so the download offer is on.
  const download = docs.getByRole('button', { name: /Download OpenAPI Document/i });
  await expect(download).toHaveCount(2); // json + yaml
  // Named after the document, not Scalar's positional fallback (`api-1`).
  const [file] = await Promise.all([docs.waitForEvent('download'), download.first().click()]);
  expect(file.suggestedFilename()).toBe('apione-studio-api.json');
  expect(blocked, 'nothing on the page may be refused by the CSP').toEqual([]);

  // The badge is only worth writing if it reaches the page. The sidebar starts collapsed, so
  // open the group the write endpoints live in.
  await docs.getByRole('button', { name: /^files/ }).click();
  await expect(docs.getByText('spec:write').first()).toBeVisible();
});
