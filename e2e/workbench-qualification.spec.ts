import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('qualifies explicit criteria offline and independently verifies the report', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Workbench', exact: true }).click();
  await page.getByRole('tab', { name: 'Qualification', exact: true }).click();
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Run qualification', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Declared criteria passed');
  await page.getByRole('button', { name: 'Verify saved qualification report' }).click();
  await expect(
    page.getByText('Report independently reconstructed. Consistency is not authentication.', {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel('Redact qualification output', { exact: true }).check();
  await expect(page.getByLabel('Qualification output JSON')).not.toHaveValue(/README.md/);
  expect(
    (await new AxeBuilder({ page }).include('#workbench-workspace').analyze()).violations,
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  );
  await page.getByLabel('Qualification profile JSON', { exact: true }).fill('{}');
  await expect(page.getByRole('status')).toHaveCount(0);
});
