import { test, expect } from '@playwright/test';
import { authenticate, createUserViaDialog } from './helpers';
import { zh } from '../src/i18n/zh';

// Backend errors are localized: the server sends a stable code (+ params); the UI renders the
// active language's string. The suite runs in English, where a real translation and the English
// fallback look the same — so this one switches to Chinese, and asserts against the locale table
// rather than a copy of it.
test('backend error codes render as localized messages', async ({ page }) => {
  await authenticate(page);
  const uname = `dup${Date.now()}`;
  await page.getByLabel('Manage users').click();
  await createUserViaDialog(page, uname);
  await expect(page.getByLabel(`role-${uname}`, { exact: true })).toBeVisible();

  await page.evaluate(() => localStorage.setItem('apione-lang', 'zh'));
  await page.reload();

  // Same username again → 409 username_taken, interpolated in zh, shown in the dialog (no panel).
  await page.getByLabel(zh.manageUsers).click();
  await page.getByLabel(zh.newUser).click();
  await page.getByLabel('new-user-username').fill(uname);
  await page.getByRole('button', { name: zh.create }).click();
  await expect(page.getByText(zh.err_username_taken.replace('{{username}}', uname))).toBeVisible();
});
