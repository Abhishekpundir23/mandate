import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Workbench' }).click();
});

test('policy edits clear decisions and every displayed check remains advisory', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Check action' }).click();
  await expect(page.getByRole('status', { name: 'Action decision' })).toContainText('ALLOW');
  await expect(page.getByRole('status', { name: 'Action decision' })).toContainText(
    'executionPerformed: false',
  );
  await page.getByRole('textbox', { name: 'Policy JSON' }).fill('{');
  await expect(page.getByRole('status', { name: 'Action decision' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Apply policy' }).click();
  await expect(page.getByRole('alert')).toContainText('valid JSON');
  await expect(page.getByRole('button', { name: 'Check action' })).toBeDisabled();
  await page.getByRole('button', { name: 'Reset draft' }).click();
  await page.getByRole('combobox', { name: 'Operation' }).selectOption('git.push');
  await page.getByRole('button', { name: 'Check action' }).click();
  await expect(page.getByRole('status', { name: 'Action decision' })).toContainText('BLOCK');
  await page.getByRole('combobox', { name: 'Policy template' }).selectOption('review-required');
  await page.getByRole('button', { name: 'Load template' }).click();
  await page.getByRole('button', { name: 'Apply policy' }).click();
  await page.getByRole('combobox', { name: 'Operation' }).selectOption('git.commit');
  await page.getByRole('button', { name: 'Check action' }).click();
  await expect(page.getByRole('status', { name: 'Action decision' })).toContainText('CONFIRM');
  await expect(page.getByText('No confirmation token is issued here.')).toBeVisible();
});

test('keyboard navigation reaches historical authority and analysis without changing current checks', async ({
  page,
}) => {
  await page.getByRole('tab', { name: 'Policy', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Revisions', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'History', exact: true })).toBeFocused();
  await page.getByRole('combobox', { name: 'Inspect version' }).selectOption('1');
  await expect(page.getByText('No clauses match this view.')).toBeVisible();
  await page.getByRole('tab', { name: 'History', exact: true }).focus();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Analysis', exact: true })).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Policy analysis' })).toBeVisible();
  await page.keyboard.press('Home');
  await page.getByRole('button', { name: 'Check action' }).click();
  await expect(page.getByRole('status', { name: 'Action decision' })).toContainText('Version 2');
});

test('policy tools have no serious accessibility violations across decisions and panels', async ({
  page,
}) => {
  for (const tab of ['Policy', 'History', 'Compare', 'Analysis']) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    const audit = await new AxeBuilder({ page }).analyze();
    expect(
      audit.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical'),
    ).toEqual([]);
  }
  await page.getByRole('tab', { name: 'Policy', exact: true }).click();
  await page.getByRole('button', { name: 'Check action' }).click();
  const audit = await new AxeBuilder({ page }).analyze();
  expect(
    audit.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical'),
  ).toEqual([]);
});

test('offline checks work without requests or browser errors', async ({ page, context }) => {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Check action' }).click();
  await page.getByRole('textbox', { name: 'File path' }).fill('src/no-real-file.ts');
  await page.getByRole('button', { name: 'Check action' }).click();
  await expect(page.getByText('2 recorded checks')).toBeVisible();
  await expect(page.getByRole('status', { name: 'Action decision' })).toContainText('ALLOW');
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});

test('responsive workbench keeps controls reachable and records a review screenshot', async ({
  page,
}, testInfo) => {
  if (!testInfo.project.name.includes('mobile'))
    await page.setViewportSize({ width: 793, height: 496 });
  await expect(page.getByRole('button', { name: 'Apply policy' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check action' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
  for (const button of await page.getByRole('button').all()) {
    if (!(await button.isVisible())) continue;
    const box = await button.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({ path: testInfo.outputPath('workbench-policy.png'), fullPage: true });
});
