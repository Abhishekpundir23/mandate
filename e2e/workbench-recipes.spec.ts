import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('compiles and runs explicit recipes offline without horizontal overflow', async ({ page, context }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Workbench', exact: true }).click();
  await page.getByRole('tab', { name: 'Recipes', exact: true }).click(); await context.setOffline(true);
  await expect(page.getByRole('button', { name: 'Run compiled scenario' })).toBeDisabled();
  await page.getByRole('button', { name: 'Compile recipe', exact: true }).click();
  await expect(page.getByLabel('Compiled scenario JSON')).toHaveValue(/fingerprint/);
  await page.getByRole('button', { name: 'Run compiled scenario' }).click();
  await expect(page.getByRole('status')).toContainText('Mandate passed');
  expect((await new AxeBuilder({ page }).include('#workbench-workspace').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await page.getByLabel('Recipe JSON', { exact: true }).fill('{}');
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Run compiled scenario' })).toBeDisabled();
});
