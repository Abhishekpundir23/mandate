import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

async function expectNoSeriousViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const violations = results.violations
    .filter(({ impact }) => impact === 'critical' || impact === 'serious')
    .map(({ id, impact, nodes }) => ({
      id,
      impact,
      targets: nodes.map(({ target }) => target),
    }));
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

async function tabTo(page: Page, target: Locator, limit = 40): Promise<void> {
  for (let index = 0; index < limit; index += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((node) => node === document.activeElement)) return;
  }
  throw new Error(`Keyboard focus did not reach ${await target.getAttribute('aria-label') ?? await target.textContent()}`);
}

test('Live and Benchmark have zero serious or critical axe violations in flagship and non-flagship states', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Run comparison' }).click();
  await expect(page.getByText('Exact mandate satisfied')).toBeVisible();
  await expectNoSeriousViolations(page);

  await page.getByRole('combobox', { name: 'Scenario' }).selectOption('preview-is-not-deploy');
  await page.getByRole('button', { name: 'Run comparison' }).click();
  await expect(page.getByRole('status')).toContainText('Replay complete');
  await expectNoSeriousViolations(page);

  const mobile = testInfo.project.name.includes('mobile');
  if (mobile) await page.setViewportSize({ width: 1200, height: 844 });
  await page.getByRole('button', { name: 'Benchmark' }).click();
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Exact mandate benchmark' })).toBeVisible();
  await expectNoSeriousViolations(page);

  await page.getByRole('button', { name: 'Select Preview is not deploy' }).click();
  await expect(page.getByRole('complementary', { name: 'Selected scenario evidence' }))
    .toContainText('release.deployProduction');
  await expectNoSeriousViolations(page);
});

test('keyboard-only journey reaches navigation, selector, Run, disclosure, tabs, sorting, selection, and inspector', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.locator('body').focus();

  const liveNav = page.getByRole('button', { name: 'Live run' });
  const benchmarkNav = page.getByRole('button', { name: 'Benchmark' });
  const selector = page.getByRole('combobox', { name: 'Scenario' });
  const run = page.getByRole('button', { name: 'Run comparison' });
  const mobile = testInfo.project.name.includes('mobile');
  if (!mobile) {
    await tabTo(page, liveNav);
    await tabTo(page, benchmarkNav);
  }
  await tabTo(page, selector);
  await page.keyboard.press('Home');
  await tabTo(page, run);
  await page.keyboard.press('Enter');
  await expect(page.getByText('Exact mandate satisfied')).toBeVisible();

  const disclosure = page.getByRole('button', { name: /v3 Do not submit/i });
  await tabTo(page, disclosure);
  await page.keyboard.press('Enter');
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Enter');
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');

  if (mobile) {
    const standard = page.getByRole('tab', { name: 'Standard' });
    await tabTo(page, standard);
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Mandate' })).toBeFocused();
    return;
  }

  await benchmarkNav.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Exact mandate benchmark' })).toBeVisible();

  const sort = page.getByRole('button', { name: 'Sort by Scenario' });
  await tabTo(page, sort);
  await page.keyboard.press('Enter');
  await expect(sort.locator('xpath=ancestor::th')).toHaveAttribute('aria-sort', 'ascending');
  const select = page.getByRole('button', { name: 'Select Preview is not deploy' });
  await tabTo(page, select);
  await page.keyboard.press('Enter');
  const inspector = page.getByRole('complementary', { name: 'Selected scenario evidence' });
  await expect(inspector).toContainText('release.deployProduction');
  await tabTo(page, inspector);
  await expect(inspector).toBeFocused();
});
