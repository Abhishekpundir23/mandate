import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { getPolicyTemplate } from '../src/policy/templates';
import { recordSession } from '../src/sessions/record';
import { verifySession } from '../src/sessions/verify';

const read = { operation: 'workspace.readFile' as const, args: { repositoryId: 'mandate', path: 'README.md' } };
const push = { operation: 'git.push' as const, args: { repositoryId: 'mandate', remoteId: 'origin', ref: 'refs/heads/main', commitOid: 'a'.repeat(40) } };
const policy = JSON.stringify(getPolicyTemplate('draft-only').policy);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Workbench' }).click();
});

test('recorded decisions can be filtered, explained and exported for independent verification', async ({ page }) => {
  await page.getByRole('button', { name: 'Check action' }).click();
  await page.getByRole('combobox', { name: 'Operation' }).selectOption('git.push');
  await page.getByRole('button', { name: 'Check action' }).click();
  await page.getByRole('tab', { name: 'Sessions', exact: true }).click();
  await page.getByRole('combobox', { name: 'Filter outcome' }).selectOption('BLOCK');
  await expect(page.getByRole('table', { name: 'Recorded action checks' }).getByRole('row')).toHaveCount(2);
  await page.getByRole('button', { name: 'Inspect check 2' }).click();
  await expect(page.getByRole('region', { name: 'Selected session check' })).toContainText('deny-push');
  const exported = await page.getByRole('textbox', { name: 'Session export JSON' }).inputValue();
  const verified = verifySession(exported);
  expect(verified.ok).toBe(true);
  expect(verified.authenticated).toBe(false);
  await page.getByRole('button', { name: 'Show redacted report' }).click();
  const redacted = await page.getByRole('textbox', { name: 'Redacted report JSON' }).inputValue();
  expect(redacted).not.toContain('README.md');
  expect(redacted).not.toContain('commitOid');
});

test('a verified import loses its verification state as soon as it is edited', async ({ page }) => {
  await page.getByRole('tab', { name: 'Sessions', exact: true }).click();
  const original = recordSession(policy, [read, push], 'browser-import');
  await page.getByRole('textbox', { name: 'Import session JSON' }).fill(JSON.stringify(original));
  await page.getByRole('button', { name: 'Verify session' }).click();
  await expect(page.getByRole('status', { name: 'Session import status' })).toHaveText('Verified internally · not authenticated');
  const forged = JSON.parse(JSON.stringify(original));
  forged.records[1].result.decision.outcome = 'ALLOW';
  await page.getByRole('textbox', { name: 'Import session JSON' }).fill(JSON.stringify(forged));
  await expect(page.getByRole('status', { name: 'Session import status' })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Session export JSON' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Verify session' }).click();
  await expect(page.getByRole('alert')).toContainText('Session verification failed');
  await page.getByRole('button', { name: 'Inspect current session' }).click();
  await expect(page.getByRole('heading', { name: 'Current session' })).toBeVisible();
});

test('session pagination, comparison and recorder reset stay separate', async ({ page }) => {
  await page.getByRole('tab', { name: 'Sessions', exact: true }).click();
  const imported = recordSession(policy, Array.from({ length: 25 }, () => read), 'many-records');
  await page.getByRole('textbox', { name: 'Import session JSON' }).fill(JSON.stringify(imported));
  await page.getByRole('button', { name: 'Verify session' }).click();
  await page.getByRole('button', { name: 'Next records' }).click();
  await expect(page.getByText('Page 2 of 3', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search records' }).fill('absent-resource');
  await expect(page.getByText('No records match these filters.')).toBeVisible();
  await page.getByRole('textbox', { name: 'Comparison session JSON' }).fill(JSON.stringify(recordSession(policy, [], 'empty')));
  await page.getByRole('button', { name: 'Compare sessions' }).click();
  await expect(page.getByRole('status', { name: 'Session comparison status' })).toContainText('25 changed records');
  await page.getByRole('button', { name: 'Start new session' }).click();
  await expect(page.getByRole('heading', { name: 'Imported session' })).toBeVisible();
  await page.getByRole('button', { name: 'Inspect current session' }).click();
  await expect(page.getByText('0 records · advisory · executionPerformed: false')).toBeVisible();
});

test('custom lab runs reproduce their report and never change canonical benchmark results', async ({ page }) => {
  await page.getByRole('tab', { name: 'Lab', exact: true }).click();
  await page.getByRole('button', { name: 'Run sandbox scenario' }).click();
  await page.getByText('Complete report JSON', { exact: true }).click();
  const first = await page.getByRole('textbox', { name: 'Lab report JSON' }).inputValue();
  expect(JSON.parse(first).externalActionsPerformed).toBe(false);
  await page.getByRole('button', { name: 'Run sandbox scenario' }).click();
  expect(await page.getByRole('textbox', { name: 'Lab report JSON' }).inputValue()).toBe(first);
  await page.getByRole('combobox', { name: 'Policy experiment', exact: true }).selectOption('retire-tombstone');
  await page.getByRole('button', { name: 'Run policy experiment' }).click();
  await expect(page.getByRole('status', { name: 'Experiment status' })).toContainText('3 of 3 expectations passed');
  await page.getByRole('button', { name: 'Benchmark', exact: true }).click();
  await expect(page.getByRole('main', { name: 'Benchmark results' }).locator('tbody tr')).toHaveCount(15);
  await expect(page.getByText(/Reproducible · seed checksum/)).toContainText('1c48b617');
});

test('sessions and lab remain accessible, responsive and usable offline', async ({ page, context }) => {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Check action' }).click();
  for (const tab of ['Sessions', 'Lab']) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    const audit = await new AxeBuilder({ page }).analyze();
    expect(audit.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  }
  await page.getByRole('button', { name: 'Run sandbox scenario' }).click();
  await expect(page.getByRole('region', { name: 'Sandbox results' })).toBeVisible();
  const audit = await new AxeBuilder({ page }).analyze();
  expect(audit.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([]);
  expect(errors).toEqual([]);
  expect(requests).toEqual([]);
});
