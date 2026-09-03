import { expect, type Locator, type Page } from '@playwright/test';
import { en } from '../src/i18n/en';

// Shared across the suite. The whole run hits ONE backend + ONE fresh DB (see playwright.config),
// so tests stay serial (workers: 1) and lean on these for auth and user provisioning.

/** The en locale string for `key`, with {{param}} placeholders filled in — so copy assertions
 * track the locale table instead of hardcoding sentences. */
export function msg(key: keyof typeof en, params: Record<string, string | number> = {}) {
  return Object.entries(params).reduce((s, [k, v]) => s.replaceAll(`{{${k}}}`, String(v)), en[key]);
}

// Auth is always required: the gate either creates the admin (first run) or logs in.
// The submit control is stable regardless of mode, so one helper covers both.
export async function authenticate(page: Page) {
  await page.goto('/');
  await page.getByLabel('auth-username').fill('admin');
  await page.getByLabel('auth-password').fill('secret12');
  await page.getByLabel('auth-submit').click();
  await expect(page.getByLabel('New project', { exact: true })).toBeVisible(); // reached the app
}

/** Create a project via the + dialog and wait until the workspace has the starter loaded. */
export async function createProject(page: Page, name: string) {
  await page.getByLabel('New project', { exact: true }).click();
  await page.getByPlaceholder(/Project name/).fill(name);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText(msg('emptyProject'))).toBeVisible();
}

/** Add an endpoint on the design canvas: + opens a placeholder GET as the detail, then the
 * method/path are set there. Enter on the path commits it into the outline. */
export async function addEndpoint(page: Page, method: string, path: string) {
  await page.getByLabel('add-endpoint').click();
  if (method !== 'get') await page.getByLabel('op-method').selectOption(method);
  await page.getByLabel('op-path').fill(path);
  await page.getByLabel('op-path').press('Enter');
}

/**
 * A dnd-kit drag: press on `source`, clear the 4px activation distance with a straight 12px
 * vertical move (toward the target, or `activateDy` when given), glide to `target`'s center,
 * release — then wait out dnd-kit's post-drop click swallower (a capture-phase `click` listener
 * on the document, torn down by a 50ms setTimeout) so the next click can land. No hand reaches
 * another control that fast; the driver does.
 *
 * - `sourcePosition`: grab offset from `source`'s top-left (default: its center).
 * - `activateDy`: explicit activation direction; also defers reading `target`'s box until the
 *   drag is in flight, for drop targets that only render then (the empty untagged group).
 * - `beforeDrop`: runs mid-gesture, pointer over the target, button still down.
 * - `settle: false` skips the post-drop wait — for tests about starting a drag immediately.
 */
export async function drag(
  page: Page,
  source: Locator,
  target: Locator,
  opts: {
    sourcePosition?: { x?: number; y?: number };
    activateDy?: number;
    beforeDrop?: () => Promise<unknown>;
    settle?: boolean;
  } = {},
) {
  const sb = (await source.boundingBox())!;
  const sx = sb.x + (opts.sourcePosition?.x ?? sb.width / 2);
  const sy = sb.y + (opts.sourcePosition?.y ?? sb.height / 2);
  let dy = opts.activateDy;
  if (dy === undefined) {
    const tb = (await target.boundingBox())!;
    dy = tb.y + tb.height / 2 < sy ? -12 : 12;
  }
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx, sy + dy);
  const tb = (await target.boundingBox())!;
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 10 });
  if (opts.beforeDrop) await opts.beforeDrop();
  await page.mouse.up();
  if (opts.settle !== false) await page.waitForTimeout(120);
}

// The op tag control is a combobox (TagSelect): open it, type, Enter to pick/create.
export async function setOpTag(page: Page, name: string) {
  await page.getByLabel('op-tags').click();
  await page.getByLabel('op-tags-search').fill(name);
  await page.getByLabel('op-tags-search').press('Enter');
}

// Admin provisions a user via the dialog and captures the random password shown once on the
// credentials panel. Assumes the admin console is already open.
export async function createUserViaDialog(page: Page, username: string, role: 'member' | 'admin' = 'member') {
  await page.getByLabel('New user').click();
  await page.getByLabel('new-user-username').fill(username);
  await page.getByLabel('new-user-role').selectOption(role);
  await page.getByRole('button', { name: 'Create' }).click();
  const pw = (await page.getByLabel('issued-password').textContent()) ?? '';
  await page.getByRole('button', { name: 'Done' }).click();
  return pw;
}

/** A co-author saving the same file: read it over the API, edit it, write it back. The editor
 * under test never sees this happen — that is the point. */
export async function otherAuthorWrites(page: Page, projectId: string, edit: (content: string) => string) {
  const tok = await page.evaluate(() => localStorage.getItem('apione-token'));
  const headers = { Authorization: `Bearer ${tok}` };
  const url = `/api/projects/${projectId}/files/openapi.yaml`;
  const read = await (await page.request.get(url, { headers })).json();
  const res = await page.request.put(url, {
    headers,
    data: { content: edit(read.content), baseVersion: read.version },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}
