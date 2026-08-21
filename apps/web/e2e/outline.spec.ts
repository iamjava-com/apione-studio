import { test, expect } from '@playwright/test';
import { addEndpoint, authenticate, createProject, drag, msg, setOpTag } from './helpers';

// Tag-grouping + routing: tagging an operation groups the outline like the docs do,
// groups collapse, and the URL reflects the open project / mode / selection.
test('tag grouping, collapsible groups, and URL routing', async ({ page }) => {
  await authenticate(page);
  await createProject(page, `Tags ${Date.now()}`);

  // Opening a project puts its id in the URL (single source of truth).
  await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/p\//);

  // The starter's one operation is untagged → flat list, no group headers yet.
  await expect(page.getByLabel('group-untagged')).toBeHidden();

  // Tag it via the form → the outline groups by tag, mirroring the docs.
  await page.getByLabel('open-op-get-/hello').click();
  await expect.poll(() => new URL(page.url()).searchParams.get('sel')).toBe('op:get:/hello');
  await setOpTag(page, 'Users');
  await expect(page.getByLabel('group-Users')).toBeVisible();

  // Add an untagged endpoint → an "untagged" group appears alongside "Users".
  await addEndpoint(page, 'get', '/things');
  await expect(page.getByLabel('group-untagged')).toBeVisible();

  // Tags are editable in the detail → setting one moves the op into that group.
  await addEndpoint(page, 'get', '/admin');
  await setOpTag(page, 'Admin');
  await expect(page.getByLabel('group-Admin')).toBeVisible();

  // Outline delete (hover-revealed) removes the op — via the in-app confirm — and its solo group goes.
  await page
    .getByLabel('open-op-get-/admin')
    .locator('xpath=following-sibling::div//button[@aria-label="delete-op"]')
    .click();
  await page.getByLabel('confirm-ok').click();
  await expect(page.getByLabel('group-Admin')).toBeHidden();

  // Collapse the Users group → its operation is hidden.
  await page.getByLabel('group-Users').click();
  await expect(page.getByLabel('open-op-get-/hello')).toBeHidden();
  await page.getByLabel('group-Users').click(); // expand again
  await expect(page.getByLabel('open-op-get-/hello')).toBeVisible();

  // Search/filter narrows the outline to matching operations.
  await page.getByLabel('outline-filter').fill('things');
  await expect(page.getByLabel('open-op-get-/things')).toBeVisible();
  await expect(page.getByLabel('open-op-get-/hello')).toBeHidden();
  await page.getByLabel('outline-filter').fill('');
  await expect(page.getByLabel('open-op-get-/hello')).toBeVisible();

  // Info detail is the authoritative tag list; 'Users' is there. Create a new tag with +.
  await page.getByRole('button', { name: 'Info' }).click();
  await expect(page.getByLabel('tag-name').first()).toHaveValue('Users');
  await page.getByLabel('add-tag').click();
  const newTag = page.getByLabel('tag-name').first(); // the just-added declared tag sorts first
  await newTag.fill('Billing');
  await newTag.press('Enter');

  // A declared-but-unused tag shows as an (empty) group in the outline.
  await expect(page.getByLabel('group-Billing')).toBeVisible();
});

// A path is one key in `paths`, so dragging one of its methods carries the whole block — and
// inside it the methods sit in the specification's field order, not the file's.
test('dragging one method of a two-method path moves the whole path block', async ({ page }) => {
  await authenticate(page);
  await createProject(page, `Methods ${Date.now()}`);

  // POST /users first, then a GET merged onto the same path — so the file lists post before get.
  await addEndpoint(page, 'post', '/users');
  await expect(page.getByLabel('open-op-post-/users')).toBeVisible();
  await addEndpoint(page, 'get', '/users');
  await expect(page.getByLabel('open-op-get-/users')).toBeVisible();
  await addEndpoint(page, 'get', '/orders');

  const order = () =>
    page.locator('[aria-label^="open-op-"]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  // GET ahead of POST: the specification's field order, not the file's.
  await expect
    .poll(order)
    .toEqual(['open-op-get-/hello', 'open-op-get-/users', 'open-op-post-/users', 'open-op-get-/orders']);

  // Each row keeps its own handle; the block is what moves, whichever one you grab.
  const card = page.locator('[aria-label="path-/users"]');
  await expect(card.locator('button[aria-label="drag-handle"]')).toHaveCount(2);

  // Every method badge in the outline starts at the same x, whether or not its path has siblings.
  const badgeX = async (label: string) => (await page.locator(`[aria-label="${label}"] span`).first().boundingBox())!.x;
  expect(await badgeX('open-op-post-/users')).toBe(await badgeX('open-op-get-/orders'));

  // Drag the card below /orders — POST /users travels with it, or nothing moves at all.
  const handle = card.locator('button[aria-label="drag-handle"]').first();
  await drag(page, handle, page.getByLabel('open-op-get-/orders'), {
    beforeDrop: () => expect(page.getByText(msg('dragPathBlock', { p: '/users', n: 2 }))).toBeVisible(),
  });

  await expect
    .poll(order)
    .toEqual(['open-op-get-/hello', 'open-op-get-/orders', 'open-op-get-/users', 'open-op-post-/users']);

  // …and back up to the top: the row shifting out from under the pointer must leave the drag
  // something to aim at, or the last position is one you can leave but never return to.
  await drag(page, handle, page.getByLabel('open-op-get-/hello'));

  await expect
    .poll(order)
    .toEqual(['open-op-get-/users', 'open-op-post-/users', 'open-op-get-/hello', 'open-op-get-/orders']);
});

// The handle belongs to the path, so a drop in another tag group re-tags every method under it.
test('dragging a two-method path into a tag group re-tags both methods', async ({ page }) => {
  await authenticate(page);
  await createProject(page, `Retag ${Date.now()}`);

  // Tag the starter op so a group exists to drop into, then build an untagged two-method path.
  await page.getByLabel('open-op-get-/hello').click();
  await setOpTag(page, 'Users');
  await expect(page.getByLabel('group-Users')).toBeVisible();
  await addEndpoint(page, 'get', '/orders');
  await addEndpoint(page, 'post', '/orders');
  await expect(page.getByLabel('open-op-post-/orders')).toBeVisible();

  // Grab the second row's handle — the whole path re-tags either way.
  const handle = page.locator('[aria-label="path-/orders"] button[aria-label="drag-handle"]').last();
  await drag(page, handle, page.getByLabel('open-op-get-/hello'));

  // Moving between groups re-measures, which used to alternate with the group just left until
  // React gave up — the error boundary is what the user saw.
  await expect(page.getByText(msg('viewCrashedTitle'))).toBeHidden();

  // Both methods carry the tag now, and nothing is left untagged.
  await expect(page.getByLabel('group-untagged')).toBeHidden();
  await page.getByLabel('open-op-post-/orders').click();
  await expect(page.getByLabel('op-tags')).toContainText('Users');
  await page.getByLabel('open-op-get-/orders').click();
  await expect(page.getByLabel('op-tags')).toContainText('Users');
});

// The capsule is the affordance, so its whole length must drag. Row handles cover only their own
// row, and with an even number of methods its grip sits in the gap between the two middle ones.
test('a multi-method path can be dragged by the capsule, between two rows', async ({ page }) => {
  await authenticate(page);
  await createProject(page, `Capsule ${Date.now()}`);
  for (const [method, path] of [
    ['get', '/users'],
    ['post', '/users'],
    ['get', '/orders'],
  ]) {
    await addEndpoint(page, method!, path!);
  }
  const order = () =>
    page.locator('[aria-label^="open-op-"]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  await expect
    .poll(order)
    .toEqual(['open-op-get-/hello', 'open-op-get-/users', 'open-op-post-/users', 'open-op-get-/orders']);

  // Grab the handle column halfway down the two-method block — between both row handles.
  await drag(page, page.locator('[aria-label="path-/users"]'), page.getByLabel('open-op-get-/orders'), {
    sourcePosition: { x: 19 },
  });

  await expect
    .poll(order)
    .toEqual(['open-op-get-/hello', 'open-op-get-/orders', 'open-op-get-/users', 'open-op-post-/users']);
});

// Untagged has no declaration keeping it alive, so it disappears the moment its last operation
// gets a tag. Without a standing drop target, that tag is one an operation can never leave.
test('the last untagged operation can be dragged back out of a tag group', async ({ page }) => {
  await authenticate(page);
  await createProject(page, `Untag ${Date.now()}`);

  await page.getByLabel('open-op-get-/hello').click();
  await setOpTag(page, 'Users');
  await addEndpoint(page, 'get', '/a');
  await expect(page.getByLabel('group-untagged')).toBeVisible();

  const handle = page
    .locator('[aria-label="open-op-get-/a"]')
    .locator('xpath=preceding-sibling::button[@aria-label="drag-handle"]');

  // Into Users — the untagged group has nothing left and stops being rendered.
  await drag(page, handle, page.getByLabel('open-op-get-/hello'));
  await expect(page.getByLabel('group-untagged')).toBeHidden();

  // Starting a drag brings the empty untagged group back as a target, so the tag comes off.
  // (activateDy: the target only exists once the drag is in flight, so its side can't be read.)
  await drag(page, handle, page.getByLabel('group-untagged'), { activateDy: 12 });

  await page.getByLabel('open-op-get-/a').click();
  await expect(page.getByLabel('op-tags')).not.toContainText('Users');
});

// Crossing a group moves every row below it, so the row under the pointer changes without the
// pointer moving. Holding the target through that must not outlast the pointer, or an operation
// becomes one you can drag out but not back.
test('an operation dragged into a tag group can be dragged back out', async ({ page }) => {
  await authenticate(page);
  await createProject(page, `RoundTrip ${Date.now()}`);

  await page.getByLabel('open-op-get-/hello').click();
  await setOpTag(page, 'Users');
  for (const p of ['/a', '/b']) {
    await addEndpoint(page, 'get', p);
  }
  await expect(page.getByLabel('group-untagged')).toBeVisible();

  const handle = page
    .locator('[aria-label="open-op-get-/a"]')
    .locator('xpath=preceding-sibling::button[@aria-label="drag-handle"]');

  // Up into Users…
  await drag(page, handle, page.getByLabel('open-op-get-/hello'));
  await expect(page.getByLabel('group-Users')).toHaveText(/Users\s*2/);
  await expect(page.getByLabel('group-untagged')).toHaveText(/Untagged\s*1/);

  // …and back down to untagged.
  await drag(page, handle, page.getByLabel('open-op-get-/b'));
  await expect(page.getByLabel('group-Users')).toHaveText(/Users\s*1/);
  await expect(page.getByLabel('group-untagged')).toHaveText(/Untagged\s*2/);
});

// Rows differ in height (a summary adds a line), so a drop used to animate them into place over a
// couple of hundred milliseconds — and a drag started in that window measured a position the row
// was already leaving, catching nothing.
test('a drag started immediately after a drop still lands', async ({ page }) => {
  await authenticate(page);
  await createProject(page, `Rapid ${Date.now()}`);
  for (const [path, summary] of [
    ['/a', 'list a'],
    ['/b', 'list b'],
  ]) {
    await addEndpoint(page, 'get', path!);
    await page.getByLabel('Summary').fill(summary!);
    await page.getByLabel('Summary').blur();
  }

  const order = () =>
    page.locator('[aria-label^="open-op-"]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  await expect.poll(order).toEqual(['open-op-get-/hello', 'open-op-get-/a', 'open-op-get-/b']);

  const handleOf = (label: string) =>
    page.locator(`[aria-label="${label}"]`).locator('xpath=preceding-sibling::button[@aria-label="drag-handle"]');

  // Two drags back to back, with nothing in between to let an animation finish — settle would
  // defeat the point.
  await drag(page, handleOf('open-op-get-/a'), page.getByLabel('open-op-get-/b'), { settle: false });
  await drag(page, handleOf('open-op-get-/a'), page.getByLabel('open-op-get-/hello'), { settle: false });

  await expect.poll(order).toEqual(['open-op-get-/a', 'open-op-get-/hello', 'open-op-get-/b']);
});

// Picking something up and putting it back has to work: if the dragged item is not itself a drop
// target, its own slot does not exist and every release lands on a neighbour.
test('picking an operation up and putting it back changes nothing', async ({ page }) => {
  await authenticate(page);
  await createProject(page, `InPlace ${Date.now()}`);
  for (const p of ['/a', '/b']) {
    await addEndpoint(page, 'get', p);
  }
  // Tag the first and last so the outline's order stops matching the file's: a drop that writes
  // anyway reorders `paths` — a diff from a gesture that changed nothing on screen.
  await page.getByLabel('open-op-get-/hello').click();
  await setOpTag(page, 'Users');
  await page.getByLabel('open-op-get-/b').click();
  await setOpTag(page, 'Users');
  const start = ['open-op-get-/hello', 'open-op-get-/b', 'open-op-get-/a'];
  await expect.poll(order3).toEqual(start);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByLabel('unsaved')).toBeHidden();

  // Not a drag to a target — a wiggle inside the row's own slot, so it stays hand-rolled.
  const handle = page
    .locator('[aria-label="open-op-get-/a"]')
    .locator('xpath=preceding-sibling::button[@aria-label="drag-handle"]');
  const hb = (await handle.boundingBox())!;
  const x = hb.x + hb.width / 2;
  const y = hb.y + hb.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 14); // past the 4px activation, still inside its own row
  await page.waitForTimeout(60);
  await page.mouse.move(x, y + 2);
  await page.waitForTimeout(60);
  await page.mouse.up();

  await expect.poll(order3).toEqual(start);
  // Not just the same order: a drop that changed nothing must not have written to the doc at all.
  await expect(page.getByLabel('unsaved')).toBeHidden();

  function order3() {
    return page.locator('[aria-label^="open-op-"]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  }
});

// The outline groups by tag; the file does not have to. A drop moves the one path it dragged and
// leaves the rest of `paths` alone, or it reads as an edit the author never made.
test('a drop moves the dragged path only, leaving the rest of the file in place', async ({ page }) => {
  await authenticate(page);
  await createProject(page, `Minimal ${Date.now()}`);
  for (const p of ['/a', '/b']) {
    await addEndpoint(page, 'get', p);
  }
  // File order is /hello, /a, /b; tagging the outer two groups them above the untagged /a.
  await page.getByLabel('open-op-get-/hello').click();
  await setOpTag(page, 'Users');
  await page.getByLabel('open-op-get-/b').click();
  await setOpTag(page, 'Users');

  // Drag /hello under /b, inside the Users group.
  const handle = page
    .locator('[aria-label="open-op-get-/hello"]')
    .locator('xpath=preceding-sibling::button[@aria-label="drag-handle"]');
  await drag(page, handle, page.getByLabel('open-op-get-/b'));

  await page.getByRole('button', { name: 'YAML', exact: true }).click();
  // /a never moved: it keeps the first slot it had in the file, above the two that were dragged.
  await expect
    .poll(async () =>
      ((await page.locator('.monaco-editor').first().innerText()).match(/^\s{2}\/\w+:/gm) ?? []).map((s) => s.trim()),
    )
    .toEqual(['/a:', '/b:', '/hello:']);
});
