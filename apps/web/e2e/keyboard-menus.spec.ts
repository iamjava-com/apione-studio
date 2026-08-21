import { test, expect } from '@playwright/test';
import { authenticate } from './helpers';

// Both menus are revealed by CSS, so nothing but a real browser can say whether a keyboard
// reaches them.
test('the account and language menus open without a mouse', async ({ page }) => {
  await authenticate(page);

  const account = page.getByRole('button', { name: /@/ }).first();
  await account.focus();
  await expect(page.getByRole('button', { name: 'Log out', exact: true })).toBeVisible();

  await page.getByLabel('switch-language').focus();
  await expect(page.getByRole('button', { name: 'English' })).toBeVisible();
});
