import { expect, test } from '@playwright/test';

test('desktop Live comparison proves the unsafe and safe outcomes before a deterministic 15-row benchmark', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop journey');

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Live comparison' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Replay ready');
  await expect(page.getByText('APPLICATION SUBMITTED')).toHaveCount(0);
  await expect(page.getByText('BLOCKED by mandate v3')).toHaveCount(0);
  await expect(page.getByText('DRAFT PRESERVED')).toHaveCount(0);
  await expect(page.getByText('Exact mandate satisfied')).toHaveCount(0);
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
  await expect(page.getByRole('button', { name: 'Live run' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Benchmark' })).toBeVisible();
  await expect(page.getByText('APPLICATION SUBMITTED')).toHaveCount(0);
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

  await page.getByRole('button', { name: 'Benchmark' }).click();
  await expect(page.getByRole('button', { name: 'Run benchmark' })).toBeVisible();
});

test('all fifteen benchmark rows and truthful failure labels remain reachable in the exact desktop scrollport', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Exact desktop geometry proof');
  await page.goto('/');
  await page.getByRole('button', { name: 'Benchmark' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(15);

  const geometry = await page.locator('.scenario-table-scroll').evaluate((scrollport) => {
    const viewport = scrollport.getBoundingClientRect();
    const rows = [...scrollport.querySelectorAll('tbody tr')].map((row) => {
      const box = row.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom };
    });
    return {
      scrollTop: scrollport.scrollTop,
      horizontalOverflow: scrollport.scrollWidth - scrollport.clientWidth,
      verticalOverflow: scrollport.scrollHeight - scrollport.clientHeight,
      firstRowFullyVisible: (rows[0]?.top ?? 0) >= viewport.top - 0.5
        && (rows[0]?.bottom ?? 0) <= viewport.bottom + 0.5,
    };
  });
  expect(geometry).toMatchObject({
    scrollTop: 0,
    horizontalOverflow: 0,
    firstRowFullyVisible: true,
  });
  expect(geometry.verticalOverflow).toBeGreaterThan(0);

  const lastRow = page.locator('tbody tr').last();
  await lastRow.scrollIntoViewIfNeeded();
  await expect(lastRow).toBeInViewport({ ratio: 1 });
  const scrolledGeometry = await page.locator('.scenario-table-scroll').evaluate((scrollport) => {
    const viewport = scrollport.getBoundingClientRect();
    const heading = scrollport.querySelector('thead')?.getBoundingClientRect();
    return {
      scrollTop: scrollport.scrollTop,
      headingFullyVisible: heading !== undefined
        && heading.top >= viewport.top - 0.5
        && heading.bottom <= viewport.bottom + 0.5,
    };
  });
  expect(scrolledGeometry.scrollTop).toBeGreaterThan(0);
  expect(scrolledGeometry.headingFullyVisible).toBe(true);

  const failureLabels = page.locator('.failure-label');
  await expect(failureLabels).toHaveCount(15);
  for (const label of await failureLabels.all()) {
    await expect(label).toHaveAttribute('aria-label', /.+/);
    await expect(label).toHaveAttribute('title', /.+/);
  }
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
