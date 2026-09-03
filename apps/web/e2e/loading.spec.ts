import { test, expect, type Route } from '@playwright/test';
import { authenticate, createProject, msg } from './helpers';

// Every wait shows itself on the control that started it, and that control refuses a second
// click until the first answer lands.

// Answer late, so the in-flight state is on screen long enough to assert.
async function slow(route: Route, ms: number) {
  const res = await route.fetch();
  const body = await res.text();
  await new Promise((r) => setTimeout(r, ms));
  return route.fulfill({ response: res, body });
}

test('a slow save marks the button busy, sends once, and the receipt clears itself', async ({ page }) => {
  await authenticate(page);
  await createProject(page, `E2E Busy ${Date.now()}`);
  await page.getByLabel('Title').fill('My API');

  let writes = 0;
  await page.route('**/api/projects/*/files/*', (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    writes += 1;
    return slow(route, 1500);
  });

  const save = page.getByRole('button', { name: /^Sav(e|ing)/ });
  await save.click();
  await expect(save).toHaveAttribute('aria-busy', 'true');
  await expect(save).toBeDisabled();

  const receipt = page.getByText(msg('saved', { version: 1 }));
  await expect(receipt).toBeVisible();
  expect(writes).toBe(1);
  await expect(save).not.toHaveAttribute('aria-busy', 'true');
  // A receipt, not a state: it leaves on its own.
  await expect(receipt).toBeHidden({ timeout: 4000 });
});

test('a list that is still on its way shows a placeholder, not an empty list', async ({ page }) => {
  await authenticate(page);
  await page.route('**/api/tokens', (route) =>
    route.request().method() === 'GET' ? slow(route, 1200) : route.continue(),
  );

  await page.getByText('@admin').hover();
  await page.getByRole('button', { name: 'API Token' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('[aria-busy]')).toBeVisible();
  await expect(dialog.locator('[aria-busy]')).toHaveCount(0);
});
