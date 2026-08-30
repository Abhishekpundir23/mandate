import { expect, test } from '@playwright/test';

test('all meaningful controls stay inside the local origin', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'The full origin-interception control tour runs once at desktop.');
  const externalRequests: string[] = [];
  await page.route('**/*', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.origin !== 'http://127.0.0.1:4173') {
      externalRequests.push(requestUrl.href);
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });

  await page.goto('/');
  await page.getByRole('combobox', { name: 'Scenario' }).selectOption('draft-is-not-submit');
  await page.getByRole('button', { name: 'Run comparison' }).click();
  await expect(page.getByText('Exact mandate satisfied')).toBeVisible();
  await page.getByRole('button', { name: /v3 Do not submit/i }).click();

  const mandateTab = page.getByRole('tab', { name: 'Mandate' });
  if (await mandateTab.isVisible()) await mandateTab.click();

  await page.getByRole('button', { name: 'Benchmark' }).click();
  await page.getByRole('button', { name: 'Sort by Scenario' }).click();
  await page.getByRole('button', { name: 'Select Preview is not deploy' }).click();
  await page.getByRole('button', { name: 'Run benchmark' }).click();
  await expect(page.getByRole('status')).toContainText('Benchmark recomputed');
  expect(externalRequests).toEqual([]);
});
