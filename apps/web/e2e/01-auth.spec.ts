import { test, expect } from '@playwright/test';
import { authenticate, msg } from './helpers';

// The 01- prefix keeps this file first (workers: 1 → files run in path order), so this test hits
// the genuine first-run (needsSetup=true) on a pristine DB before any other test creates the admin.
// After logout the gate must flip to login, proving needsSetup went false.
test('after first-run setup + logout, the gate shows login (not create-admin)', async ({ page }) => {
  await authenticate(page); // first run → creates the admin, lands in the app
  await page.getByText('@admin').hover(); // reveal the account menu
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByLabel('auth-submit')).toHaveText(msg('login')); // login gate, not Create admin
});

// Self-service change-password: both guard paths (kept failing so the admin password is untouched).
test('change-password dialog guards mismatch and wrong current password', async ({ page }) => {
  await authenticate(page);
  await page.getByText('@admin').hover();
  await page.getByRole('button', { name: 'Change password' }).click();

  // Confirm mismatch → client-side guard.
  await page.getByLabel('current-password').fill('secret12');
  await page.getByLabel('new-password').fill('newpass12');
  await page.getByLabel('confirm-password').fill('different2');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(msg('passwordMismatch'))).toBeVisible();

  // Matching new, but wrong current → server refuses with the localized code.
  await page.getByLabel('confirm-password').fill('newpass12');
  await page.getByLabel('current-password').fill('wrongpass');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(msg('err_wrong_password'))).toBeVisible();
});
