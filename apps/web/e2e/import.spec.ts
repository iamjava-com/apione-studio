import { test, expect } from '@playwright/test';
import { authenticate, createProject, msg } from './helpers';

// Replace path: a Postman collection is converted to OpenAPI via Settings → Replace.
test('replace a project spec from a Postman collection (Settings)', async ({ page }) => {
  await authenticate(page);
  await createProject(page, `Import ${Date.now()}`);

  const collection = JSON.stringify({
    info: { name: 'PM E2E', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    item: [
      {
        name: 'Get thing',
        request: {
          method: 'GET',
          url: { raw: 'https://api.test/things/:id', host: ['api', 'test'], path: ['things', ':id'] },
        },
      },
    ],
  });
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Import', exact: true }).click(); // Settings → Import section
  await page.getByLabel('replace-spec-file').setInputFiles({
    name: 'collection.json',
    mimeType: 'application/json',
    buffer: Buffer.from(collection),
  });
  await page.getByLabel('confirm-ok').click(); // in-app overwrite confirm

  // After replace, the form reloads with the converted spec: title = collection name.
  await expect(page.getByLabel('Title')).toHaveValue('PM E2E', { timeout: 5000 });
});

test('replacing the spec while Mock is open drops the endpoints it retired', async ({ page }) => {
  await authenticate(page);
  await createProject(page, `Mock sync ${Date.now()}`);
  await page.getByRole('button', { name: 'Save' }).click(); // the starter only exists once written
  await expect(page.getByLabel('unsaved')).toHaveCount(0);

  await page.getByRole('button', { name: 'Mock' }).click();
  await expect(page.getByText('Say hello')).toBeVisible();

  const spec =
    "openapi: 3.1.0\ninfo: { title: Replaced, version: 1.0.0 }\npaths:\n  /bye:\n    get:\n      summary: Say bye\n      responses: { '200': { description: ok } }\n";
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByLabel('replace-spec-file').setInputFiles({
    name: 'replaced.yaml',
    mimeType: 'application/yaml',
    buffer: Buffer.from(spec),
  });
  await page.getByLabel('confirm-ok').click();

  await expect(page.getByText('Say bye')).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('Say hello')).toHaveCount(0);
});

// Onboarding: create a NEW project from a spec file. Picking a file stages it in the dialog and
// prefills the name from the spec title; Import then creates and opens the project.
test('create a new project by importing a file', async ({ page }) => {
  await authenticate(page);
  await page.getByLabel('New project', { exact: true }).click();
  const spec = 'openapi: 3.1.0\ninfo: { title: Imported API, version: 1.0.0 }\npaths: {}\n';
  await page.getByLabel('import-new-file').setInputFiles({
    name: `spec-${Date.now()}.yaml`,
    mimeType: 'application/yaml',
    buffer: Buffer.from(spec),
  });
  // Staged: the name is prefilled from info.title (not the file name).
  await expect(page.getByPlaceholder(/Project name/)).toHaveValue('Imported API', { timeout: 5000 });
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByLabel('Title')).toHaveValue('Imported API', { timeout: 5000 });
});

// Dropping a spec on the project list stages it in the new-project dialog (same path as the picker),
// name prefilled from the spec title; Import then creates it.
test('drag-and-drop a spec file onto the list imports it', async ({ page }) => {
  await authenticate(page);
  const title = `Dropped ${Date.now()}`;
  const spec = `openapi: 3.1.0\ninfo: { title: ${title}, version: 1.0.0 }\npaths: {}\n`;
  const dataTransfer = await page.evaluateHandle((content) => {
    const dt = new DataTransfer();
    dt.items.add(new File([content], 'dropped.yaml', { type: 'application/yaml' }));
    return dt;
  }, spec);
  const zone = page.getByRole('heading', { name: 'Projects' });
  await zone.dispatchEvent('dragenter', { dataTransfer });
  await zone.dispatchEvent('drop', { dataTransfer });
  await expect(page.getByPlaceholder(/Project name/)).toHaveValue(title, { timeout: 5000 });
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByLabel('Title')).toHaveValue(title, { timeout: 5000 });
});

// A file we can't read still opens the dialog and reports there, never on the list.
test('dropping a non-spec file reports inside the dialog', async ({ page }) => {
  await authenticate(page);
  const dataTransfer = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['not a spec'], 'clip.mp4', { type: 'video/mp4' }));
    return dt;
  });
  const zone = page.getByRole('heading', { name: 'Projects' });
  await zone.dispatchEvent('dragenter', { dataTransfer });
  await zone.dispatchEvent('drop', { dataTransfer });
  await expect(page.getByText(msg('err_invalid_spec'))).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
});

// Dropping on the dialog's own dropzone must stage exactly once — the drop must not also bubble
// (React tree) to the page-level drop handler and end up creating a second project.
test('importing via the dialog dropzone creates exactly one project', async ({ page }) => {
  await authenticate(page);
  const title = `Once ${Date.now()}`;
  const spec = `openapi: 3.1.0\ninfo: { title: ${title}, version: 1.0.0 }\npaths: {}\n`;
  await page.getByLabel('New project', { exact: true }).click();
  const dataTransfer = await page.evaluateHandle((content) => {
    const dt = new DataTransfer();
    dt.items.add(new File([content], 'once.yaml', { type: 'application/yaml' }));
    return dt;
  }, spec);
  await page.getByLabel('import-dropzone').dispatchEvent('drop', { dataTransfer });
  await expect(page.getByPlaceholder(/Project name/)).toHaveValue(title, { timeout: 5000 });
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByLabel('Title')).toHaveValue(title, { timeout: 5000 });

  await page.getByLabel('Back to projects').click();
  await expect(page.getByText(title)).toHaveCount(1); // not two
});
