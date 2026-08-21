import { test, expect } from '@playwright/test';
import { authenticate, createProject, drag } from './helpers';

// Grouping is organisation only: filing a project changes where it sits, never who can reach it,
// and deleting a group must leave its projects standing.
test('a project can be filed under a group, and deleting the group keeps it', async ({ page }) => {
  await authenticate(page);
  const stamp = Date.now();
  const projectName = `GP ${stamp}`;
  const groupName = `G ${stamp}`;

  await createProject(page, projectName);

  await page.goto('/');
  // Created it → own it, so the card says so.
  await expect(page.getByRole('button').filter({ hasText: projectName }).getByLabel('Owner')).toBeVisible();

  await page.getByLabel('New group').click();
  await page.getByLabel('group-name').fill(groupName);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: groupName })).toBeVisible();

  // An empty group keeps its band — it is the place you file things into, so it must be reachable.
  const band = page.locator('section').filter({ has: page.getByRole('heading', { name: groupName }) });
  await expect(band.getByRole('button', { name: 'New project here', exact: true })).toBeVisible();
  // The ungrouped band stays headerless — the project is on the page but outside the group.
  await expect(band.getByText(projectName, { exact: true })).toHaveCount(0);
  await expect(page.getByText(projectName, { exact: true })).toBeVisible();

  // File it via project settings.
  await page.getByText(projectName, { exact: true }).click();
  await page.getByRole('button', { name: 'Settings' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('button', { name: 'General' }).click();
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes('/api/projects/')),
    dlg.getByLabel('project-group').selectOption({ label: groupName }),
  ]);
  await page.keyboard.press('Escape');

  await page.goto('/');
  const section = page.locator('section').filter({ has: page.getByRole('heading', { name: groupName }) });
  await expect(section.getByText(projectName, { exact: true })).toBeVisible();

  // Deleting the group must not take the project with it.
  await page.getByLabel(`Delete group: ${groupName}`).click();
  await page.getByLabel('confirm-ok').click();
  await expect(page.getByRole('heading', { name: groupName })).toHaveCount(0);
  await expect(page.getByText(projectName, { exact: true })).toBeVisible();
});

// Filing by drag: the whole band is the target (nothing to order, so nothing to aim at), and the
// ungrouped band grows a header while dragging so a filed project can be taken back out.
test('a project can be dragged into a group and back out, and a group folds away', async ({ page }) => {
  await authenticate(page);
  const stamp = Date.now();
  const projectName = `DR ${stamp}`;
  const groupName = `DG ${stamp}`;

  await createProject(page, projectName);

  await page.goto('/');
  await page.getByLabel('New group').click();
  await page.getByLabel('group-name').fill(groupName);
  await page.getByRole('button', { name: 'Create' }).click();
  const band = page.locator('section').filter({ has: page.getByRole('heading', { name: groupName }) });
  await expect(band).toBeVisible();

  const card = page.getByRole('button').filter({ hasText: projectName });

  await drag(page, card, band);
  await expect(band.getByText(projectName, { exact: true })).toBeVisible();

  // Folding hides the projects but keeps the count, so nothing goes silently missing.
  await page.getByLabel(`Collapse group "${groupName}"`).click();
  await expect(band.getByText(projectName, { exact: true })).toBeHidden();
  await expect(band.getByText('1', { exact: true })).toBeVisible();
  await page.getByLabel(`Expand group "${groupName}"`).click();
  await expect(band.getByText(projectName, { exact: true })).toBeVisible();

  // The fold survives a reload — one that resets every visit is a fold nobody uses.
  await page.getByLabel(`Collapse group "${groupName}"`).click();
  await page.reload();
  await expect(band.getByText(projectName, { exact: true })).toBeHidden();
  await page.getByLabel(`Expand group "${groupName}"`).click();

  // Drag it back out onto the ungrouped band, which only has a header while a drag is in flight.
  const ungrouped = page.locator('section').first();
  await drag(page, card, ungrouped);
  await expect(band.getByText(projectName, { exact: true })).toHaveCount(0);
  await expect(ungrouped.getByText(projectName, { exact: true })).toBeVisible();
});

// The picker only offers projects whose roster the caller may already read; choosing one takes
// the whole roster, each with the role they hold there.
test('members can be imported wholesale from another project', async ({ page }) => {
  await authenticate(page);
  const stamp = Date.now();
  const source = `SRC ${stamp}`;
  const target = `DST ${stamp}`;
  const helper = `cp${stamp}`;

  await page.getByLabel('Manage users').click();
  await page.getByLabel('New user').click();
  await page.getByLabel('new-user-username').fill(helper);
  await page.getByRole('button', { name: 'Create' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  for (const name of [source, target]) {
    await page.goto('/');
    await createProject(page, name);
  }

  // Put the helper on the source as an editor.
  await page.goto('/');
  await page.getByText(source, { exact: true }).click();
  await page.getByRole('button', { name: 'Settings' }).click();
  const srcDlg = page.getByRole('dialog');
  await srcDlg.getByRole('button', { name: 'Members' }).click();
  await srcDlg.getByLabel('Select a user').click();
  await srcDlg.getByLabel('Select a user-search').fill(helper);
  await srcDlg.getByLabel('Select a user-search').press('Enter');
  await srcDlg.getByRole('combobox').first().selectOption('editor');
  await srcDlg.getByRole('button', { name: 'Add' }).click();
  await expect(srcDlg.getByLabel(`role-${helper}`)).toBeVisible();
  await page.keyboard.press('Escape');

  // Copy that roster into the target.
  await page.goto('/');
  await page.getByText(target, { exact: true }).click();
  await page.getByRole('button', { name: 'Settings' }).click();
  const dstDlg = page.getByRole('dialog');
  await dstDlg.getByRole('button', { name: 'Members' }).click();
  await dstDlg.getByRole('button', { name: 'Import members from another project' }).click();
  const copyDlg = page.getByRole('dialog').filter({ has: page.getByLabel('Select a project') });
  await copyDlg.getByLabel('Select a project').selectOption({ label: source });
  await expect(copyDlg.getByText(helper, { exact: true })).toBeVisible(); // preview, not a chooser
  await copyDlg.getByRole('button', { name: 'Import' }).click();

  // Arrived with the role it had on the source.
  await expect(dstDlg.getByLabel(`role-${helper}`)).toHaveValue('editor');
});
