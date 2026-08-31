import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { expect, test } from '@playwright/test';

function builtPaths(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `/${relative(root, join(entry.parentPath, entry.name)).split(sep).join('/')}`);
}

test('the complete product tour stays inside the closed local capability envelope', async ({ page }) => {
  const allowedPaths = new Set(['/', '/index.html', ...builtPaths('dist')]);
  const requests: string[] = [];
  const unexpectedRequests: string[] = [];
  const browserEscapes: string[] = [];
  const consoleFailures: string[] = [];

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    const violations: string[] = [];
    Object.defineProperty(globalThis, '__mandateSecurityViolations', { value: violations });
    const block = (capability: string): never => {
      violations.push(capability);
      throw new Error(`Blocked capability: ${capability}`);
    };

    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: () => block('fetch') });
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: class { constructor() { block('WebSocket'); } } });
    Object.defineProperty(globalThis, 'EventSource', { configurable: true, value: class { constructor() { block('EventSource'); } } });
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: () => block('sendBeacon') });
    const open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (...args: Parameters<XMLHttpRequest['open']>) {
      violations.push(`XMLHttpRequest:${String(args[1])}`);
      return open.apply(this, args);
    } as XMLHttpRequest['open'];

    for (const method of ['setItem', 'removeItem', 'clear'] as const) {
      Object.defineProperty(Storage.prototype, method, {
        configurable: true,
        value: () => block(`Storage.${method}`),
      });
    }
    if ('indexedDB' in globalThis) {
      for (const method of ['open', 'deleteDatabase'] as const) {
        Object.defineProperty(IDBFactory.prototype, method, {
          configurable: true,
          value: () => block(`indexedDB.${method}`),
        });
      }
    }
    if ('caches' in globalThis) {
      for (const method of ['open', 'delete'] as const) {
        Object.defineProperty(CacheStorage.prototype, method, {
          configurable: true,
          value: () => block(`caches.${method}`),
        });
      }
    }
    const cookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
    if (cookie?.set !== undefined) {
      Object.defineProperty(Document.prototype, 'cookie', { ...cookie, set: () => block('document.cookie') });
    }

    for (const property of ['innerHTML', 'outerHTML'] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, property);
      if (descriptor?.set !== undefined) {
        Object.defineProperty(Element.prototype, property, {
          ...descriptor,
          set: () => block(`Element.${property}`),
        });
      }
    }
    Element.prototype.insertAdjacentHTML = () => block('Element.insertAdjacentHTML');
    HTMLFormElement.prototype.submit = () => block('form.submit');
    HTMLFormElement.prototype.requestSubmit = () => block('form.requestSubmit');
    globalThis.open = () => block('window.open');
    history.pushState = () => block('history.pushState');
    history.replaceState = () => block('history.replaceState');

    const NativeFunction = globalThis.Function;
    Object.defineProperty(globalThis, 'Function', {
      configurable: true,
      value: new Proxy(NativeFunction, {
        apply: () => block('Function()'),
        construct: () => block('new Function()'),
      }),
    });
    globalThis.addEventListener('securitypolicyviolation', (event) => {
      violations.push(`CSP:${event.violatedDirective}:${event.blockedURI}`);
    });
  });

  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push(`${request.method()} ${url.origin}${url.pathname}`);
    if (request.method() !== 'GET' || url.origin !== 'http://127.0.0.1:4173' || !allowedPaths.has(url.pathname)) {
      unexpectedRequests.push(`${request.method()} ${url.href}`);
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  page.on('popup', () => browserEscapes.push('popup'));
  page.on('download', () => browserEscapes.push('download'));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      consoleFailures.push(`${message.type()}:${message.text()}`);
    }
  });
  page.on('pageerror', (error) => consoleFailures.push(`pageerror:${error.message}`));
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame()) browserEscapes.push(`frame:${frame.url()}`);
  });

  await page.goto('/');
  const scenarioPicker = page.getByRole('combobox', { name: 'Scenario' });
  const scenarioValues = await scenarioPicker.locator('option').evaluateAll((options) =>
    options.map((option) => (option as HTMLOptionElement).value));
  expect(scenarioValues).toHaveLength(15);
  for (const scenarioId of scenarioValues) {
    await scenarioPicker.selectOption(scenarioId);
    await expect(page.getByRole('status')).toHaveText('Replay ready');
    await page.getByRole('button', { name: 'Run comparison' }).click();
    await expect(page.getByRole('status')).toHaveText('Replay complete');
    const disclosure = page.getByRole('button', { name: /Inspect|Show|Details/ }).first();
    if (await disclosure.isVisible()) await disclosure.click();
  }

  await page.getByRole('button', { name: 'Benchmark' }).click();
  const sortButtons = page.getByRole('button', { name: /^Sort by / });
  await expect(sortButtons).toHaveCount(5);
  for (const button of await sortButtons.all()) {
    await button.click();
    await expect(button.locator('xpath=ancestor::th')).toHaveAttribute('aria-sort', 'ascending');
    await button.click();
    await expect(button.locator('xpath=ancestor::th')).toHaveAttribute('aria-sort', 'descending');
  }
  const rowButtons = page.getByRole('button', { name: /^Select / });
  await expect(rowButtons).toHaveCount(15);
  for (const button of await rowButtons.all()) {
    await button.click();
    await expect(page.getByRole('complementary', { name: 'Selected scenario evidence' })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Run benchmark' }).click();
  await expect(page.getByRole('status')).toContainText('Benchmark run 1 complete');

  const violations = await page.evaluate(() =>
    (globalThis as typeof globalThis & { __mandateSecurityViolations: string[] }).__mandateSecurityViolations);
  expect(violations).toEqual([]);
  expect(unexpectedRequests).toEqual([]);
  expect(browserEscapes).toEqual([]);
  expect(consoleFailures).toEqual([]);
  expect(requests).toContain('GET http://127.0.0.1:4173/');
  expect(page.frames()).toHaveLength(1);
  expect(page.url()).toBe('http://127.0.0.1:4173/');
});
