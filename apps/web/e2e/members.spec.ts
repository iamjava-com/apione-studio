import { test, expect } from '@playwright/test';
import { authenticate, createProject, createUserViaDialog } from './helpers';

// Read-only members get no Design tab, and Settings opens on the only section they can see.
test('a read-only member has no design tab and lands on the visible settings section', async ({ page }) => {
  await authenticate(page); // admin
  const viewer = `ro${Date.now()}`;

  // Provision a plain member.
  await page.getByLabel('Manage users').click();
  const pw = await createUserViaDialog(page, viewer);
  await expect(page.getByLabel(`role-${viewer}`, { exact: true })).toBeVisible();

  // Create a project and share it with the member as a viewer.
  await page.goto('/');
  await createProject(page, `RO ${Date.now()}`);

  await page.getByRole('button', { name: 'Settings' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('button', { name: 'Members' }).click();
  // Add-member is a searchable user picker (combobox); role defaults to viewer.
  await dlg.getByLabel('Select a user').click();
  await dlg.getByLabel('Select a user-search').fill(viewer);
  await dlg.getByLabel('Select a user-search').press('Enter');
  await dlg.getByRole('button', { name: 'Add' }).click();
  await expect(dlg.getByText(viewer, { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  // Re-login as the viewer and open the shared project.
  await page.evaluate(() => localStorage.removeItem('apione-token'));
  await page.goto('/');
  await page.getByLabel('auth-username').fill(viewer);
  await page.getByLabel('auth-password').fill(pw);
  await page.getByLabel('auth-submit').click();
  // Invited in, not responsible for it — no owner mark anywhere in the viewer's list.
  await expect(page.getByLabel('Owner')).toHaveCount(0);
  await page.getByText(/^RO /).first().click();

  // No Design tab (editing can't be saved), and the viewer lands on Docs.
  await expect(page.getByRole('button', { name: 'Design', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Docs', exact: true })).toBeVisible();

  // Settings hides General/rename, but the roster is readable — and it opens there.
  await page.getByRole('button', { name: 'Settings' }).click();
  const roDlg = page.getByRole('dialog');
  await expect(roDlg.getByRole('button', { name: 'General' })).toHaveCount(0);
  await expect(roDlg.getByLabel('project-name')).toHaveCount(0);

  // The whole roster, own role included — this is how a viewer finds who to ask.
  await expect(roDlg.getByText('admin', { exact: true })).toBeVisible();
  await expect(roDlg.getByText('Owner', { exact: true })).toBeVisible();
  await expect(roDlg.getByText(viewer, { exact: true })).toBeVisible();
  await expect(roDlg.getByText('Viewer', { exact: true })).toBeVisible();

  // Read-only means read-only: no add/import, and no per-row role select or remove.
  await expect(roDlg.getByLabel('Select a user')).toHaveCount(0);
  await expect(roDlg.getByRole('button', { name: 'Add' })).toHaveCount(0);
  await expect(roDlg.getByRole('button', { name: /Import members/ })).toHaveCount(0);
  await expect(roDlg.getByLabel(`role-${viewer}`)).toHaveCount(0);
  await expect(roDlg.getByLabel(`remove-${viewer}`)).toHaveCount(0);

  await roDlg.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(roDlg.getByText(/Export as OpenAPI/)).toBeVisible();
});

// Creating a project leaves an admin holding both a membership and the bypass — which once hid
// their own exit.
test('an admin who owns a project can still leave it', async ({ page }) => {
  await authenticate(page); // admin
  const mate = `mate${Date.now()}`;

  await page.getByLabel('Manage users').click();
  await createUserViaDialog(page, mate);
  await expect(page.getByLabel(`role-${mate}`, { exact: true })).toBeVisible();

  await page.goto('/');
  const name = `Handoff ${Date.now()}`;
  await createProject(page, name);

  await page.getByRole('button', { name: 'Settings' }).click();
  const dlg = page.getByRole('dialog');

  // A sole owner is refused, so hand it over first.
  await dlg.getByRole('button', { name: 'Members' }).click();
  await dlg.getByLabel('Select a user').click();
  await dlg.getByLabel('Select a user-search').fill(mate);
  await dlg.getByLabel('Select a user-search').press('Enter');
  await dlg.getByLabel('Role', { exact: true }).selectOption('owner');
  await dlg.getByRole('button', { name: 'Add' }).click();
  await expect(dlg.getByText(mate, { exact: true })).toBeVisible();

  await dlg.getByRole('button', { name: 'Danger zone' }).click();
  await dlg.getByRole('button', { name: 'Leave project' }).click();
  await page.getByLabel('confirm-ok').click();

  await page.goto('/');
  await page.getByText(name, { exact: true }).first().click();
  await page.getByRole('button', { name: 'Settings' }).click();
  const after = page.getByRole('dialog');
  await after.getByRole('button', { name: 'Members' }).click();
  await expect(after.getByText(mate, { exact: true })).toBeVisible();
  await expect(after.getByText('admin', { exact: true })).toHaveCount(0);

  await after.getByRole('button', { name: 'Danger zone' }).click();
  await expect(after.getByRole('button', { name: 'Leave project' })).toHaveCount(0);

  // Joining back mid-dialog has to reach the button, without a reload.
  await after.getByRole('button', { name: 'Members' }).click();
  await after.getByLabel('Select a user').click();
  await after.getByLabel('Select a user-search').fill('admin');
  await after.getByLabel('Select a user-search').press('Enter');
  await after.getByRole('button', { name: 'Add' }).click();
  await expect(after.getByText('admin', { exact: true })).toBeVisible();

  await after.getByRole('button', { name: 'Danger zone' }).click();
  await expect(after.getByRole('button', { name: 'Leave project' })).toBeVisible();
});
