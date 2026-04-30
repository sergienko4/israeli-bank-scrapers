/**
 * Extra coverage for CreateElementMediator — resolveVisible + resolveAndClick + extractActionMediator + attribute/href paths (split).
 */

import type { Frame, Locator, Page } from 'playwright-core';

import createElementMediator, {
  extractActionMediator,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/CreateElementMediator.js';
import {
  CANDIDATE_KINDS,
  makeRichLocator,
  makeRichPage,
} from './CreateElementMediatorExtraHelpers.js';

describe('CreateElementMediator resolveVisible — coverage of all candidate kinds', () => {
  it('returns NOT_FOUND when all locators throw on waitFor', async () => {
    const locator = makeRichLocator({ visible: false });
    const page = makeRichPage({ locator });
    const m = createElementMediator(page);
    const result = await m.resolveVisible(CANDIDATE_KINDS, 50);
    expect(result.found).toBe(false);
  }, 15000);

  it('returns found result when first locator becomes visible', async () => {
    const locator = makeRichLocator({ visible: true, innerText: 'WIN', hitTest: true });
    const page = makeRichPage({ locator });
    const m = createElementMediator(page);
    const result = await m.resolveVisible([{ kind: 'textContent', value: 'Login' }], 500);
    expect(result.found).toBe(true);
  }, 5000);

  it('returns found even if hit-test fails but fallback kicks in', async () => {
    const locator = makeRichLocator({ visible: true, hitTest: false });
    const page = makeRichPage({ locator });
    const m = createElementMediator(page);
    const result = await m.resolveVisible([{ kind: 'textContent', value: 'Login' }], 500);
    expect(result.found).toBe(true);
  }, 5000);

  it('resolveVisibleInContext: returns NOT_FOUND for empty candidates', async () => {
    const locator = makeRichLocator({ visible: false });
    const page = makeRichPage({ locator });
    const m = createElementMediator(page);
    const r = await m.resolveVisibleInContext([], page);
    expect(r.found).toBe(false);
  });

  it('resolveVisibleInContext: scans given frame context only', async () => {
    const locator = makeRichLocator({ visible: true, hitTest: true });
    const page = makeRichPage({ locator });
    const m = createElementMediator(page);
    const r = await m.resolveVisibleInContext(
      [{ kind: 'textContent', value: 'X' }],
      page as unknown as Frame,
      500,
    );
    expect(r.found).toBe(true);
  }, 5000);
});

describe('CreateElementMediator resolveAndClick — with empty candidates uses submit fallback', () => {
  it('empty candidates array triggers WK submit fallback path', async () => {
    const locator = makeRichLocator({ visible: false });
    const page = makeRichPage({ locator });
    const m = createElementMediator(page);
    const result = await m.resolveAndClick([], 50);
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.found).toBe(false);
  }, 15000);

  it('clicks attached element as fallback when not visible', async () => {
    // Locator that fails visible wait but passes attached wait.
    const callCounts = { waitFor: 0 };
    const locator = {
      /**
       * first.
       * @returns Self.
       */
      first(): Locator {
        return this as unknown as Locator;
      },
      /**
       * waitFor — succeeds on attached, fails on visible.
       * @param opts - Wait options.
       * @param opts.state - Requested wait state.
       * @returns Scripted.
       */
      waitFor(opts: { state?: string }): Promise<boolean> {
        callCounts.waitFor += 1;
        if (opts.state === 'attached') return Promise.resolve(true);
        return Promise.reject(new Error('not visible'));
      },
      /**
       * evaluate.
       * @returns Fail hit-test → fallback.
       */
      evaluate(): Promise<unknown> {
        return Promise.resolve(false);
      },
      /**
       * click.
       * @returns Resolves.
       */
      click(): Promise<boolean> {
        return Promise.resolve(true);
      },
      /**
       * innerText.
       * @returns Empty string.
       */
      innerText(): Promise<string> {
        return Promise.resolve('');
      },
      /**
       * getAttribute.
       * @returns Empty.
       */
      getAttribute(): Promise<string | false> {
        return Promise.resolve(false);
      },
    } as unknown as Locator;
    const page = makeRichPage({ locator });
    const m = createElementMediator(page);
    const result = await m.resolveAndClick([{ kind: 'textContent', value: 'X' }], 50);
    expect(result.success).toBe(true);
  }, 15000);
});

describe('extractActionMediator — executor methods', () => {
  it('collectAllHrefs and countByText delegate to full mediator', async () => {
    const locator = makeRichLocator({ visible: false, attr: '/path' });
    const page = makeRichPage({ locator });
    const full = createElementMediator(page);
    const action = extractActionMediator(full, page);
    const count = await action.countByText('x');
    expect(typeof count).toBe('number');
    const hrefs = await action.collectAllHrefs();
    const isArrayResult1 = Array.isArray(hrefs);
    expect(isArrayResult1).toBe(true);
  });

  it('addCookies + getCookies round-trip', async () => {
    const locator = makeRichLocator({ visible: false });
    const page = makeRichPage({ locator });
    const full = createElementMediator(page);
    const action = extractActionMediator(full, page);
    await action.addCookies([]);
    const cookies = await action.getCookies();
    const isArrayResult2 = Array.isArray(cookies);
    expect(isArrayResult2).toBe(true);
  });

  it('collectStorage returns empty object from page.evaluate', async () => {
    const locator = makeRichLocator({ visible: false });
    const page = makeRichPage({ locator });
    const full = createElementMediator(page);
    const action = extractActionMediator(full, page);
    const storage = await action.collectStorage();
    expect(typeof storage).toBe('object');
  });
});

describe('CreateElementMediator — attribute + href + count + URL paths', () => {
  it('getAttributeValue returns attr from resolved locator', async () => {
    const locator = makeRichLocator({ visible: true, hitTest: true, attr: '/deep-link' });
    const page = makeRichPage({ locator });
    const m = createElementMediator(page);
    const race = await m.resolveVisible([{ kind: 'textContent', value: 'x' }], 500);
    expect(race.found).toBe(true);
    const attr = await m.getAttributeValue(race, 'href');
    expect(attr).toBe('/deep-link');
  }, 5000);

  it('getAttributeValue returns empty string for NOT_FOUND race result', async () => {
    const locator = makeRichLocator({ visible: false });
    const page = makeRichPage({ locator });
    const m = createElementMediator(page);
    const race = await m.resolveVisible([{ kind: 'textContent', value: 'nope' }], 20);
    expect(race.found).toBe(false);
    const attr = await m.getAttributeValue(race, 'href');
    expect(attr).toBe('');
  }, 10000);

  it('checkAttribute returns ok(true) when attr is non-empty', async () => {
    const locator = makeRichLocator({ visible: true, hitTest: true, attr: 'yes' });
    const page = makeRichPage({ locator });
    const m = createElementMediator(page);
    const race = await m.resolveVisible([{ kind: 'textContent', value: 'x' }], 500);
    const r = await m.checkAttribute(race, 'data-active');
    expect(r.success).toBe(true);
    if (r.success) expect(r.value).toBe(true);
  }, 5000);

  it('checkAttribute returns ok(false) for NOT_FOUND race', async () => {
    const locator = makeRichLocator({ visible: false });
    const page = makeRichPage({ locator });
    const m = createElementMediator(page);
    const race = await m.resolveVisible([{ kind: 'textContent', value: 'x' }], 20);
    const r = await m.checkAttribute(race, 'data-x');
    expect(r.success).toBe(true);
    if (r.success) expect(r.value).toBe(false);
  }, 10000);

  it('waitForURL returns succeed(true) when page navigates', async () => {
    const locator = makeRichLocator({ visible: false });
    const page = makeRichPage({ locator });
    const m = createElementMediator(page);
    const r = await m.waitForURL('**/dashboard', 100);
    expect(r.success).toBe(true);
    if (r.success) expect(r.value).toBe(true);
  });

  it('waitForURL returns succeed(false) on timeout', async () => {
    const locator = makeRichLocator({ visible: false });
    const page = {
      ...makeRichPage({ locator }),
      /**
       * waitForURL — reject to simulate timeout.
       * @returns Rejected promise.
       */
      waitForURL: (): Promise<boolean> => Promise.reject(new Error('timeout')),
    } as unknown as Page;
    const m = createElementMediator(page);
    const r = await m.waitForURL('**/dashboard', 50);
    expect(r.success).toBe(true);
    if (r.success) expect(r.value).toBe(false);
  });

  it('navigateTo returns failure when page.goto throws', async () => {
    const locator = makeRichLocator({ visible: false });
    const page = {
      ...makeRichPage({ locator }),
      /**
       * goto — reject with error.
       * @returns Rejected promise.
       */
      goto: (): Promise<false> => Promise.reject(new Error('nav fail')),
    } as unknown as Page;
    const m = createElementMediator(page);
    const r = await m.navigateTo('https://nope.example');
    expect(r.success).toBe(false);
  });

  it('navigateTo succeeds on normal goto', async () => {
    const locator = makeRichLocator({ visible: false });
    const page = makeRichPage({ locator });
    const m = createElementMediator(page);
    const r = await m.navigateTo('https://bank.co.il');
    expect(r.success).toBe(true);
  });

  it('waitForNetworkIdle swallows timeout non-fatally', async () => {
    const locator = makeRichLocator({ visible: false });
    const page = {
      ...makeRichPage({ locator }),
      /**
       * waitForLoadState — reject to trigger catch.
       * @returns Rejected.
       */
      waitForLoadState: (): Promise<boolean> => Promise.reject(new Error('slow')),
    } as unknown as Page;
    const m = createElementMediator(page);
    const r = await m.waitForNetworkIdle(50);
    expect(r.success).toBe(true);
  });

  it('countByText returns number from locator.count()', async () => {
    const locator = makeRichLocator({ visible: false });
    const page = makeRichPage({ locator });
    const m = createElementMediator(page);
    const n = await m.countByText('Login');
    expect(typeof n).toBe('number');
  });

  it('getCurrentUrl returns page.url() synchronously', () => {
    const locator = makeRichLocator({ visible: false });
    const page = makeRichPage({ locator, url: 'https://bank.co.il/home' });
    const m = createElementMediator(page);
    const getCurrentUrlResult3 = m.getCurrentUrl();
    expect(getCurrentUrlResult3).toBe('https://bank.co.il/home');
  });
});
