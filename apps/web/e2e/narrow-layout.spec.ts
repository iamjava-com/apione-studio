import { test, expect, type Locator } from '@playwright/test';
import { addEndpoint, authenticate, createProject } from './helpers';

// A narrow window (browser docked to one side) used to squeeze the name and description columns to
// nothing, because every row let itself collapse instead of overflowing. Floors + horizontal scroll.
const NAME_FLOOR = 200; // w-52 = 13rem = 208px, minus sub-pixel rounding
const DESC_FLOOR = 152; // min-w-[10rem] = 160px, same allowance

async function widthOf(el: Locator) {
  const box = await el.boundingBox();
  return box?.width ?? 0;
}

test('name and description columns hold their floor in a narrow window', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 900 });
  await authenticate(page);
  await createProject(page, `Narrow ${Date.now()}`);

  // A query parameter row.
  await addEndpoint(page, 'get', '/notes');
  await page.getByLabel('add-param-query').click();
  await expect(page.getByLabel('param-name')).toBeVisible();

  expect(await widthOf(page.getByLabel('param-name'))).toBeGreaterThanOrEqual(NAME_FLOOR);
  expect(await widthOf(page.getByLabel('param-description'))).toBeGreaterThanOrEqual(DESC_FLOOR);

  // The row overflows rather than collapsing, so the params section scrolls sideways.
  const overflows = await page.getByLabel('param-name').evaluate((el) => {
    const scroller = el.closest('.overflow-x-auto') as HTMLElement | null;
    return scroller ? scroller.scrollWidth > scroller.clientWidth : false;
  });
  expect(overflows).toBe(true);

  // A schema field row — same two columns, plus tree indentation eating into the name.
  await page.getByLabel('add-schema').click();
  const card = page.locator('#sec-schema-newschema');
  await card.getByRole('button', { name: 'Field' }).click();

  expect(await widthOf(card.getByLabel('field-name'))).toBeGreaterThanOrEqual(NAME_FLOOR);
  expect(await widthOf(card.getByLabel('node-description').nth(1))).toBeGreaterThanOrEqual(DESC_FLOOR);
});
