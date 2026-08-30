import { expect, test } from '@playwright/test';

test('desktop Live comparison proves the unsafe and safe outcomes before a deterministic 15-row benchmark', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop journey');

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Live comparison' })).toBeVisible();
  await page.getByRole('button', { name: 'Run comparison' }).click();
  await expect(page.getByRole('status')).toContainText('Replaying');
  await expect(page.getByText('APPLICATION SUBMITTED')).toBeVisible();
  await expect(page.getByText('BLOCKED by mandate v3')).toBeVisible();
  await expect(page.getByText('Exact mandate satisfied')).toBeVisible();

  await page.getByRole('button', { name: 'Benchmark' }).click();
  await expect(page.getByRole('heading', { name: 'Exact mandate benchmark' })).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(15);
  await expect(page.getByRole('row', { name: /Preview is not deploy/ })).toBeVisible();

  const reproducibility = page.getByText(/Reproducible · seed checksum/);
  const before = await reproducibility.textContent();
  await page.getByRole('button', { name: 'Run benchmark' }).click();
  await expect(page.getByRole('status')).toContainText('Benchmark recomputed');
  await expect(reproducibility).toHaveText(before ?? '');
});

test('mobile Run supports arrow-key trace navigation and one visible stacked trace', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile journey');

  await page.goto('/');
  await page.getByRole('button', { name: 'Run comparison' }).click();
  await expect(page.getByRole('status')).toContainText('Replaying');
  await expect(page.getByText('APPLICATION SUBMITTED')).toBeVisible();

  const standard = page.getByRole('tab', { name: 'Standard' });
  const mandate = page.getByRole('tab', { name: 'Mandate' });
  await standard.focus();
  await page.keyboard.press('ArrowRight');
  await expect(mandate).toBeFocused();
  await expect(mandate).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'Mandate' })).toBeVisible();
  await expect(page.getByRole('tabpanel', { name: 'Standard' })).toBeHidden();
  await expect(page.locator('[role="tabpanel"]')).toHaveCount(2);
  await expect(page.locator('[role="tabpanel"]:visible')).toHaveCount(1);
  await expect(page.getByRole('complementary', { name: 'Authority and completion evidence' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Completion receipt' })).toBeVisible();
  await expect(page.getByText('Exact mandate satisfied')).toBeVisible();
});

test('200% zoom-equivalent reflow keeps all primary controls reachable without page clipping', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Reflow journey runs once');
  await page.setViewportSize({ width: 793, height: 496 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Run comparison' }).click();

  await expect(page.getByRole('button', { name: 'Run comparison' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Standard' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Mandate' })).toBeVisible();
  const overflow = await page.evaluate(() => ({
    body: document.body.scrollWidth - document.body.clientWidth,
    root: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(overflow).toEqual({ body: 0, root: 0 });

  await page.getByRole('button', { name: 'Benchmark' }).click();
  await expect(page.getByRole('button', { name: 'Run benchmark' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sort by Scenario' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Selected scenario evidence' })).toBeVisible();
});
