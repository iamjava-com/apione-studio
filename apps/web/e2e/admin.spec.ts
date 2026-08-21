import { test, expect } from '@playwright/test';
import { authenticate, createUserViaDialog } from './helpers';

// Admin console: provision a user, change role, disable, then delete — all from the top-bar entry.
test('admin manages users: create, promote, disable, delete', async ({ page }) => {
  await authenticate(page); // first-run admin
  const uname = `mem${Date.now()}`;
  await page.getByLabel('Manage users').click();
  await expect(page.getByLabel('role-admin', { exact: true })).toBeVisible(); // the admin's own row

  await page.getByLabel('New user').click();
  await page.getByLabel('new-user-username').fill(uname);
  await page.getByLabel('new-user-role').selectOption('member');
  await page.getByRole('button', { name: 'Create' }).click();
  // Create issues a random password and hands it off via the credentials panel (10 chars shown once).
  await expect(page.getByLabel('issued-password')).toHaveText(/^.{10}$/);
  await expect(page.getByLabel('copy-credentials')).toBeVisible();
  // This dialog replaces the create dialog, so the two overlap while mounting. If the overlay
  // painted on top of the panel, no click inside it could land — Playwright refuses a click that
  // another element would intercept, so Done landing IS the assertion.
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByLabel('issued-password')).toBeHidden();

  const roleSel = page.getByLabel(`role-${uname}`, { exact: true });
  await expect(roleSel).toBeVisible();

  // Promote member → admin (persists through the refresh).
  await roleSel.selectOption('admin');
  await expect(roleSel).toHaveValue('admin');

  // Reset password → confirm, then the shared credentials panel hands off a fresh 10-char password.
  await page.getByLabel(`reset-${uname}`, { exact: true }).click();
  await page.getByLabel('confirm-ok').click();
  await expect(page.getByLabel('issued-password')).toHaveText(/^.{10}$/);
  await page.getByRole('button', { name: 'Done' }).click();

  // Disable (in-app confirm) → the toggle re-arms as "enable" (only rendered while disabled).
  await page.getByLabel(`disable-${uname}`, { exact: true }).click();
  await page.getByLabel('confirm-ok').click();
  await expect(page.getByLabel(`enable-${uname}`, { exact: true })).toBeVisible();

  // Delete (in-app confirm) → the row (and its controls) go away.
  await page.getByLabel(`delete-${uname}`, { exact: true }).click();
  await page.getByLabel('confirm-ok').click();
  await expect(page.getByLabel(`role-${uname}`, { exact: true })).toHaveCount(0);
});

// Gating: a member sees no entry and is bounced when deep-linking to /admin.
test('non-admins cannot reach user management', async ({ page }) => {
  await authenticate(page); // admin provisions a plain member
  const uname = `plain${Date.now()}`;
  await page.getByLabel('Manage users').click();
  const pw = await createUserViaDialog(page, uname);
  await expect(page.getByLabel(`role-${uname}`, { exact: true })).toBeVisible();

  // Re-login as that member.
  await page.evaluate(() => localStorage.removeItem('apione-token'));
  await page.goto('/');
  await page.getByLabel('auth-username').fill(uname);
  await page.getByLabel('auth-password').fill(pw);
  await page.getByLabel('auth-submit').click();
  await expect(page.getByLabel('New project', { exact: true })).toBeVisible();

  // No top-bar entry; deep-linking to /admin/users bounces back to the project list.
  await expect(page.getByLabel('Manage users')).toHaveCount(0);
  await page.goto('/admin/users');
  await expect(page.getByLabel('New project', { exact: true })).toBeVisible();
  await expect(page.getByLabel('New user')).toHaveCount(0);
});
