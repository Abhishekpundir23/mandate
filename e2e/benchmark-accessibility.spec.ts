import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

type SeriousViolation = Awaited<ReturnType<AxeBuilder['analyze']>>['violations'][number];

function seriousOrCritical(violations: readonly SeriousViolation[]): readonly SeriousViolation[] {
  return violations.filter(({ impact }) => impact === 'critical' || impact === 'serious');
}

async function expectNoSeriousViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const violations = seriousOrCritical(results.violations);
  const summary = violations.map(({ id, impact, nodes }) => ({
    id,
    impact,
    targets: nodes.map(({ target }) => target),
  }));
  expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
}

test('Benchmark has no serious axe violations across selected scenario states', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Benchmark' }).click();
  await expect(page.getByRole('heading', { name: 'Exact mandate benchmark' })).toBeVisible();

  await expect(page.getByRole('button', { name: 'Select Draft is not submit' })).toBeVisible();
  await expectNoSeriousViolations(page);

  await page.getByRole('button', { name: 'Select Preview is not deploy' }).click();
  await expect(page.getByRole('complementary', { name: 'Selected scenario evidence' }))
    .toContainText('release.deployProduction');
  await expectNoSeriousViolations(page);
});
