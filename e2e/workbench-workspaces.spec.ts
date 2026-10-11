import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test.beforeEach(async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Workbench', exact: true }).click();
  await page.getByRole('tab', { name: 'Workspaces', exact: true }).click();
});
test('creates and stages a verified workspace offline with accessible inventory', async ({ page, context }) => {
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Create workspace from applied policy' }).click();
  await expect(page.getByRole('status')).toContainText('2 entries');
  await page.getByRole('table', { name: 'Workspace inventory' }).getByRole('button', { name: 'Applied policy', exact: true }).click();
  await page.getByRole('button', { name: 'Stage selected policy' }).click();
  await expect(page.getByText('Policy staged. Open Policy and Apply to replace current authority.', { exact: true })).toBeVisible();
  await page.getByLabel('Redact workspace output', { exact: true }).check();
  await expect(page.getByLabel('Workspace inventory JSON')).not.toHaveValue(/Applied policy/);
  const audit = await new AxeBuilder({ page }).include('#workbench-workspace').analyze();
  expect(audit.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});
test('renames referenced policy and invalidates verification on edits', async ({ page }) => {
  await page.getByRole('button', { name: 'Create workspace from applied policy' }).click();
  await page.getByRole('table', { name: 'Workspace inventory' }).getByRole('button', { name: 'Applied policy', exact: true }).click();
  await page.getByLabel('New entry ID', { exact: true }).fill('authority');
  await page.getByRole('button', { name: 'Rename selected entry' }).click();
  const workspace = JSON.parse(await page.getByLabel('Workspace JSON', { exact: true }).inputValue());
  expect(workspace.entries.find((entry: {kind: string}) => entry.kind === 'SESSION').references).toEqual(['authority']);
  await page.getByLabel('Workspace JSON', { exact: true }).fill('{}');
  await expect(page.getByRole('status')).toHaveCount(0);
  await page.getByRole('button', { name: 'Verify workspace', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Workspace verification failed');
});
