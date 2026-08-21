import { test, expect } from '@playwright/test';
import { addEndpoint, authenticate, createProject, msg } from './helpers';

// The Form view is the default detail-editor: title, endpoints, schemas — all before any save.
test('form editing: endpoints, schema fields, and rename propagation', async ({ page }) => {
  const name = `E2E Form ${Date.now()}`;
  await authenticate(page);
  await createProject(page, name);

  // Master-detail: Info is the default detail — edit the API title (two-way). A new project's
  // starter spec seeds its title with the project name.
  const title = page.getByLabel('Title');
  await expect(title).toHaveValue(name);
  await title.fill('My API');

  // Add an endpoint inline → a placeholder GET opens as the detail; set its path there.
  await addEndpoint(page, 'get', '/things');
  await expect(page.getByText('/things').first()).toBeVisible();

  // Add a schema → selected. Edit its nested field (field → array → integer item).
  await page.getByLabel('add-schema').click();
  const card = page.locator('#sec-schema-newschema');
  await expect(card.getByLabel('schema-name')).toHaveValue('NewSchema');
  await card.getByRole('button', { name: 'Field' }).click();
  const nodeTypes = card.getByLabel('node-type'); // [0] = schema root (object), [1] = the field
  await nodeTypes.nth(1).selectOption('array');
  await expect(card.getByText('items')).toBeVisible(); // array → items sub-editor recurses
  await nodeTypes.nth(2).selectOption('integer');

  // Duplicate a field: one → two; drag handle present.
  await expect(card.getByLabel('field-name')).toHaveCount(1);
  await card.getByLabel('duplicate-field').first().click();
  await expect(card.getByLabel('field-name')).toHaveCount(2);
  await expect(card.getByLabel('drag-handle').first()).toBeVisible();

  // Add a POST endpoint → selected. Attach a body: it defaults to an application/json schema
  // that $refs the first schema.
  await addEndpoint(page, 'post', '/widgets');
  const addBody = page.getByLabel('add-request-body');
  await expect(addBody).toBeVisible();
  await addBody.click();
  await expect(page.getByLabel('request-content-type').first()).toContainText('application/json');
  await expect(page.getByLabel('node-ref').first()).toHaveValue('NewSchema');

  // Rename propagation: select the schema, rename it, re-select the op — the $ref followed.
  await page.getByLabel('open-schema-NewSchema').click();
  const schemaName = page.getByLabel('schema-name');
  await schemaName.fill('Widget');
  await schemaName.press('Enter');
  await page.getByLabel('open-op-post-/widgets').click();
  await expect(page.getByLabel('node-ref').first()).toHaveValue('Widget');

  // Response codes are editable; a response body can be attached (still on the op).
  const firstCode = page.getByLabel('response-code').first();
  await expect(firstCode).toHaveValue('200');
  await firstCode.fill('204');
  await firstCode.blur();
  await expect(page.getByLabel('response-code').first()).toHaveValue('204');
  await page.getByLabel('add-response-body').first().click();
  await expect(page.getByLabel('response-content-type').first()).toContainText('application/json');
});

// The single write path: Save creates openapi.yaml as v1, and every read view reflects it.
test('save writes v1; YAML view, lint chip and history reflect it', async ({ page }) => {
  await authenticate(page);
  await createProject(page, `E2E Save ${Date.now()}`);
  await page.getByLabel('Title').fill('My API');

  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(msg('saved', { version: 1 }))).toBeVisible();

  // Two-way: switching to the YAML view shows the form edit.
  await page.getByText('YAML', { exact: true }).click();
  await expect(page.getByText('My API').first()).toBeVisible();

  // Lint is a passive health chip now (not a sidebar tool): silent when the saved spec is valid.
  await expect(page.getByLabel('lint-status')).toHaveCount(0);

  // Activity bar → history tool: lists the saved version.
  await page.getByLabel('tool-history').click();
  await expect(page.getByText('v1').first()).toBeVisible();
});

// Docs render inline, the theme is a single source everything follows, ⌘K searches projects.
test('docs, theme toggle, and the ⌘K command palette', async ({ page }) => {
  const name = `E2E Docs ${Date.now()}`;
  await authenticate(page);
  await createProject(page, name);
  await page.getByLabel('Title').fill('My Docs API');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(msg('saved', { version: 1 }))).toBeVisible();

  // Docs tab renders Scalar INLINE (no iframe) — assert the edited title shows.
  await page.getByText('Docs', { exact: true }).click();
  await expect(page.getByText('My Docs API').first()).toBeVisible({ timeout: 15000 });

  // Theme toggle flips the single source (html[data-theme]); everything follows — including
  // Scalar, which repaints only if body.dark-mode/.light-mode flips with it.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('body')).toHaveClass(/dark-mode/);
  await page.getByLabel('toggle theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('body')).toHaveClass(/light-mode/);
  await expect(page.locator('body')).not.toHaveClass(/dark-mode/);

  // ⌘K command palette: opens, filters to the project, Escape closes.
  await page.keyboard.press('Control+k');
  const cmdk = page.getByLabel('command-palette-input');
  await expect(cmdk).toBeVisible();
  await cmdk.fill('E2E Docs');
  await expect(page.getByText(name, { exact: false }).first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(cmdk).toBeHidden();
});

// Rename: the display name is editable in Settings → General; the id stays fixed.
test('rename a project from Settings', async ({ page }) => {
  await authenticate(page);
  await createProject(page, `Rename Src ${Date.now()}`);

  const renamed = `Renamed ${Date.now()}`;
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('project-name').fill(renamed);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await page.keyboard.press('Escape'); // close the dialog

  // The workspace header reflects the new name.
  await expect(page.getByText(renamed).first()).toBeVisible();
});

// Duplicate lives on the project card (hover-revealed); it clones the spec into a "… copy".
test('duplicate a project from the list', async ({ page }) => {
  await authenticate(page);
  const src = `Dup Src ${Date.now()}`;
  await createProject(page, src);

  // Back to the list (goto, not the in-app back — the never-saved starter is dirty and the back
  // button would raise a discard-confirm), then duplicate the source card.
  await page.goto('/');
  const card = page.locator('[role="button"]', { hasText: src });
  await card.hover();
  await card.getByLabel('Duplicate').click();

  // A copy appears alongside the original; deletion is NOT offered here (Settings only).
  await expect(page.getByText(`${src} copy`)).toBeVisible({ timeout: 5000 });
  await expect(page.getByLabel('Delete', { exact: true })).toHaveCount(0);
});

// Nested dialogs: canceling the confirm (on top of Settings) must not also close Settings.
test('canceling a confirm inside Settings keeps Settings open', async ({ page }) => {
  await authenticate(page);
  await createProject(page, `Nested ${Date.now()}`);

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Danger zone' }).click();
  await page.getByRole('button', { name: 'Delete project' }).click();
  await expect(page.getByLabel('confirm-ok')).toBeVisible(); // confirm is on top
  await page.getByLabel('confirm-cancel').click();

  // Confirm closed; Settings is still open.
  await expect(page.getByLabel('confirm-ok')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Delete project' })).toBeVisible();
});

// Path params are a projection of the URL template: {x} in the path drives them (no manual add).
test('path params sync with the URL template', async ({ page }) => {
  await authenticate(page);
  await createProject(page, `Path ${Date.now()}`);

  await addEndpoint(page, 'get', '/coupons/{couponId}');

  // {couponId} in the path auto-creates a read-only path param; there is no manual add for path.
  // (exact — the outline entry "/coupons/{couponId}" contains the same substring.)
  await expect(page.getByText('{couponId}', { exact: true })).toBeVisible();
  await expect(page.getByLabel('add-param-path')).toHaveCount(0);

  // Dropping the placeholder from the path removes the param.
  await page.getByLabel('op-path').fill('/coupons');
  await page.getByLabel('op-path').press('Enter');
  await expect(page.getByText('{couponId}', { exact: true })).toHaveCount(0);
});

// Notes are part of the contract (docs render them), so they have to reach the spec.
test('an operation, its query parameter and a schema field keep their descriptions', async ({ page }) => {
  await authenticate(page);
  await createProject(page, `Notes ${Date.now()}`);

  await addEndpoint(page, 'get', '/notes');
  await page.getByLabel('op-description').fill('Paged, newest first.');

  await page.getByLabel('add-param-query').click();
  await page.getByLabel('param-name').click();
  await page.getByLabel('param-name-search').fill('page');
  await page.getByLabel('param-name-search').press('Enter');
  await page.getByLabel('param-description').fill('1-based page index');

  await page.getByLabel('add-schema').click();
  const card = page.locator('#sec-schema-newschema');
  await card.getByRole('button', { name: 'Field' }).click();
  await card.getByLabel('node-description').nth(1).fill('Server-assigned.');

  // Round-trip through the file — a note that only lives in React state is a note nobody keeps.
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(msg('saved', { version: 1 }))).toBeVisible();
  await page.reload();

  await page.getByLabel('open-op-get-/notes').click();
  await expect(page.getByLabel('op-description')).toHaveValue('Paged, newest first.');
  await expect(page.getByLabel('param-description')).toHaveValue('1-based page index');
  await page.getByLabel('open-schema-NewSchema').click();
  await expect(card.getByLabel('node-description').nth(1)).toHaveValue('Server-assigned.');
});

// Irreversible, so the confirm asks for the name rather than a second click.
test('deleting a project asks for its name first', async ({ page }) => {
  await authenticate(page);
  const name = `Doomed ${Date.now()}`;
  await createProject(page, name);

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Danger zone' }).click();
  await page.getByRole('button', { name: 'Delete project' }).click();

  await expect(page.getByLabel('confirm-ok')).toBeDisabled();
  await page.getByLabel('confirm-text').fill(name.slice(0, -1));
  await expect(page.getByLabel('confirm-ok')).toBeDisabled(); // nearly right is still wrong
  await page.getByLabel('confirm-text').fill(name);
  await page.getByLabel('confirm-ok').click();

  await expect(page.getByText(name, { exact: true })).toHaveCount(0);
});

// Fields that only apply on blur leave the document untouched while someone is still typing, so
// saving has to count that text as unsaved and commit it on the way in.
test('saving commits the field that still has focus', async ({ page }) => {
  await authenticate(page);
  await createProject(page, `Pending ${Date.now()}`);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(msg('saved', { version: 1 }))).toBeVisible();

  await page.getByLabel('open-op-get-/hello').click();
  await page.getByLabel('op-path').fill('/renamed'); // no Enter, no blur
  await expect(page.getByLabel('unsaved')).toBeVisible();
  await page.getByRole('button', { name: 'Save' }).click();

  await page.reload();
  await expect(page.getByLabel('open-op-get-/renamed')).toBeVisible();
});
