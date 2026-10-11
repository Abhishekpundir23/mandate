import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Workbench', exact: true }).click();
  await page.getByRole('tab', { name: 'Campaigns', exact: true }).click();
});
test('runs explicit adversarial invariants offline with accessible responsive results', async ({
  page,
  context,
}) => {
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Run campaign', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('0 failed');
  await page
    .getByRole('combobox', { name: 'Campaign result filter', exact: true })
    .selectOption('failed');
  await expect(page.getByText('No campaign cases match.', { exact: true })).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Campaign result filter', exact: true })
    .selectOption('rejected');
  await expect(page.getByRole('table', { name: 'Campaign results' }).getByRole('row')).toHaveCount(
    11,
  );
  await page.getByLabel('Redact campaign output', { exact: true }).check();
  await expect(page.getByLabel('Campaign report JSON')).not.toHaveValue(/scenario-control/);
  const audit = await new AxeBuilder({ page }).include('#workbench-workspace').analyze();
  expect(audit.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  );
});
test('reproduces the previous report and invalidates results on input edits', async ({ page }) => {
  await page.getByRole('button', { name: 'Run campaign', exact: true }).click();
  const first = await page.getByLabel('Campaign report JSON').inputValue();
  await page.getByRole('button', { name: 'Run campaign', exact: true }).click();
  await expect(
    page.getByText('Compared with previous run: 0 changed cases.', { exact: true }),
  ).toBeVisible();
  expect(await page.getByLabel('Campaign report JSON').inputValue()).toBe(first);
  await page.getByLabel('Campaign JSON', { exact: true }).fill('{}');
  await expect(page.getByRole('status')).toHaveCount(0);
  await page.getByRole('button', { name: 'Run campaign', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Campaign rejected');
});
