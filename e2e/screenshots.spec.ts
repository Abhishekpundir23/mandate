import { expect, test } from '@playwright/test';

const outputRoot = '/Users/abhi/Documents/Codex/2026-08-29/hey/outputs';

test('captures the three exact non-stitched judge viewports', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Capture once from the desktop project');
  await page.emulateMedia({ reducedMotion: 'reduce' });

  await page.setViewportSize({ width: 1586, height: 992 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Run comparison' }).click();
  await expect(page.getByText('Exact mandate satisfied')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${outputRoot}/mandate-live-desktop-1586x992.png`, fullPage: false });

  await page.setViewportSize({ width: 853, height: 1844 });
  await page.reload();
  await page.getByRole('button', { name: 'Run comparison' }).click();
  await expect(page.getByText('Exact mandate satisfied')).toBeVisible();
  const mandateTab = page.getByRole('tab', { name: 'Mandate' });
  await mandateTab.click();
  await expect(mandateTab).toHaveAttribute('aria-selected', 'true');
  await expect(mandateTab).toHaveCSS('color', 'rgb(22, 72, 230)');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${outputRoot}/mandate-live-mobile-853x1844.png`, fullPage: false });

  await page.setViewportSize({ width: 1586, height: 992 });
  await page.getByRole('button', { name: 'Benchmark' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(15);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${outputRoot}/mandate-benchmark-desktop-1586x992.png`, fullPage: false });
});
