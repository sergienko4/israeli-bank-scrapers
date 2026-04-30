/**
 * Extra coverage for CreateElementMediator — countByText + getCurrentUrl edges + collectAllHrefs + resolveVisible multi (split).
 */

import type { BrowserContext, Locator, Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../../../Scrapers/Base/Config/LoginConfigTypes.js';
import createElementMediator, {
  extractActionMediator,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/CreateElementMediator.js';
import { makeRichLocator, makeRichPage } from './CreateElementMediatorExtraHelpers.js';

describe('CreateElementMediator — countByText + getCurrentUrl edge cases', () => {
  it('countByText returns 0 when count throws', async () => {
    const locator = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      first(): Locator {
        return this as unknown as Locator;
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      count(): Promise<number> {
        return Promise.reject(new Error('count fail'));
      },
    } as unknown as Locator;
    const page = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      url: (): string => 'https://bank.co.il',
      /**
       * Test helper.
       *
       * @returns Result.
       */
      goto: (): Promise<false> => Promise.resolve(false),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      on: (): Page => ({}) as Page,
      /**
       * Test helper.
       *
       * @returns Result.
       */
      waitForResponse: (): Promise<false> => Promise.race([]),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      waitForLoadState: (): Promise<boolean> => Promise.resolve(true),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      waitForURL: (): Promise<boolean> => Promise.resolve(true),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      mainFrame(): unknown {
        return this;
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      frames(): unknown[] {
        return [this];
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      getByText: (): Locator => locator,
      /**
       * Test helper.
       *
       * @returns Result.
       */
      locator: (): Locator => locator,
      /**
       * Test helper.
       *
       * @returns Result.
       */
      context: (): BrowserContext =>
        ({
          /**
           * Test helper.
           *
           * @returns Result.
           */
          cookies: (): Promise<unknown[]> => Promise.resolve([]),
          /**
           * Test helper.
           *
           * @returns Result.
           */
          addCookies: (): Promise<boolean> => Promise.resolve(true),
        }) as unknown as BrowserContext,
      /**
       * Test helper.
       *
       * @returns Result.
       */
      evaluate: (): Promise<Record<string, string>> => Promise.resolve({}),
    } as unknown as Page;
    const m = createElementMediator(page);
    const n = await m.countByText('foo');
    expect(n).toBe(0);
  });
});

describe('CreateElementMediator — collectAllHrefs evaluateAll branches', () => {
  it('returns deduplicated non-empty hrefs', async () => {
    const locator = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      first(): Locator {
        return this as unknown as Locator;
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      evaluateAll(): Promise<string[]> {
        return Promise.resolve(['/a', '/b', '/a', '']);
      },
    } as unknown as Locator;
    const page = {
      ...makeRichPage({ locator: makeRichLocator({ visible: false }) }),
      /**
       * locator override returning our evaluateAll mock.
       * @returns Custom locator.
       */
      locator: (): Locator => locator,
    } as unknown as Page;
    const m = createElementMediator(page);
    const hrefs = await m.collectAllHrefs();
    expect(hrefs).toEqual(['/a', '/b']);
  });

  it('returns empty array when evaluateAll throws', async () => {
    const locator = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      first(): Locator {
        return this as unknown as Locator;
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      evaluateAll(): Promise<string[]> {
        return Promise.reject(new Error('eval fail'));
      },
    } as unknown as Locator;
    const page = {
      ...makeRichPage({ locator: makeRichLocator({ visible: false }) }),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      locator: (): Locator => locator,
    } as unknown as Page;
    const m = createElementMediator(page);
    const hrefs = await m.collectAllHrefs();
    expect(hrefs).toEqual([]);
  });
});

describe('CreateElementMediator — resolveVisible with multiple candidates + all kinds', () => {
  // Race across ALL candidate kinds at once to exercise every switch branch.
  it('all candidate kinds produce locators (no throw on dispatch)', async () => {
    const locator = makeRichLocator({ visible: false });
    const page = makeRichPage({ locator });
    const m = createElementMediator(page);
    const all: SelectorCandidate[] = [
      { kind: 'textContent', value: 'Text' },
      { kind: 'clickableText', value: 'Click' },
      { kind: 'ariaLabel', value: 'Label' },
      { kind: 'placeholder', value: 'PH' },
      { kind: 'xpath', value: '//btn' },
      { kind: 'name', value: 'nm' },
      { kind: 'regex', value: '.*' },
      { kind: 'exactText', value: 'Exact' },
    ];
    const r = await m.resolveVisible(all, 50);
    expect(r.found).toBe(false);
  }, 15000);
});

describe('CreateElementMediator — action mediator raw methods', () => {
  it('navigateTo on action mediator delegates to full page', async () => {
    const locator = makeRichLocator({ visible: false });
    const page = makeRichPage({ locator });
    const full = createElementMediator(page);
    const action = extractActionMediator(full, page);
    const r = await action.navigateTo('https://bank.co.il');
    expect(r.success).toBe(true);
  });

  it('waitForNetworkIdle on action mediator delegates', async () => {
    const locator = makeRichLocator({ visible: false });
    const page = makeRichPage({ locator });
    const full = createElementMediator(page);
    const action = extractActionMediator(full, page);
    const r = await action.waitForNetworkIdle(50);
    expect(r.success).toBe(true);
  });

  it('waitForURL on action mediator delegates', async () => {
    const locator = makeRichLocator({ visible: false });
    const page = makeRichPage({ locator });
    const full = createElementMediator(page);
    const action = extractActionMediator(full, page);
    const r = await action.waitForURL('**/home', 50);
    expect(r.success).toBe(true);
  });

  it('getCurrentUrl on action mediator returns page URL', () => {
    const locator = makeRichLocator({ visible: false });
    const page = makeRichPage({ locator, url: 'https://bank.co.il/dash' });
    const full = createElementMediator(page);
    const action = extractActionMediator(full, page);
    const getCurrentUrlResult4 = action.getCurrentUrl();
    expect(getCurrentUrlResult4).toBe('https://bank.co.il/dash');
  });
});
