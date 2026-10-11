import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('pause, manual step, resume, and restart preserve causal evidence', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-10T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-10T00:01:00Z'));
  await page.goto('/');

  const status = page.getByRole('status');
  const next = page.getByRole('button', { name: 'Next step' });
  await expect(page.getByRole('button', { name: 'Pause replay' })).toBeDisabled();
  await next.click();
  await expect(status).toContainText('Paused at 1 of');
  await expect(page.getByText('Receipt pending replay completion')).toBeVisible();
  await expect(page.getByText('APPLICATION SUBMITTED')).toHaveCount(0);

  await page.getByRole('button', { name: 'Resume replay' }).click();
  await expect(next).toBeDisabled();
  await page.clock.runFor(180);
  await page.getByRole('button', { name: 'Pause replay' }).click();
  await expect(status).toContainText('Paused at 2 of');
  await page.clock.runFor(10_000);
  await expect(status).toContainText('Paused at 2 of');

  await next.click();
  await expect(status).toContainText('Paused at 3 of');
  await page.getByRole('button', { name: 'Restart replay' }).click();
  await expect(status).toHaveText('Replay ready');
  await expect(page.getByRole('heading', { name: 'Active authority · v0' })).toBeVisible();
  await expect(page.getByText('Exact mandate satisfied')).toHaveCount(0);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBe(0);
  await page.clock.resume();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([]);
});

test('benchmark selection opens that case in Live run with reduced-motion stepping', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Benchmark' }).click();
  await page.getByRole('button', { name: 'Select Preview is not deploy' }).click();
  await page.getByRole('button', { name: 'Open in Live run' }).click();

  await expect(page.getByRole('combobox', { name: 'Scenario' })).toHaveValue('preview-is-not-deploy');
  await expect(page.getByRole('status')).toHaveText('Replay ready');
  await page.getByRole('button', { name: 'Next step' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText('Paused at 1 of');
  await expect(page.getByText('Exact mandate satisfied')).toHaveCount(0);
  await page.getByRole('button', { name: 'Resume replay' }).click();
  await expect(page.getByRole('status')).toHaveText('Replay complete');
  await expect(page.getByRole('button', { name: 'Next step' })).toBeDisabled();
  await expect(page.getByText('Exact mandate satisfied', { exact: true })).toBeVisible();
  await expect(page.getByText('APPLICATION SUBMITTED')).toHaveCount(0);

  await page.getByRole('button', { name: 'Benchmark' }).click();
  await expect(page.getByRole('row', { name: /Preview is not deploy/ })).toHaveAttribute('aria-selected', 'true');
});
