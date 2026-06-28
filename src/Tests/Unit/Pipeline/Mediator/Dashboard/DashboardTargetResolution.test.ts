/**
 * Regression coverage for DASHBOARD target resolution ordering.
 */

import type { Page } from 'playwright-core';

import {
  extractHrefLayer3,
  extractTransactionHrefPrecise,
} from '../../../../../Scrapers/Pipeline/Mediator/Dashboard/DashboardHrefExtraction.js';
import { resolveDashboardTargets } from '../../../../../Scrapers/Pipeline/Mediator/Dashboard/DashboardPhaseActions.targets.js';
import type {
  IElementMediator,
  IRaceResult,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { NOT_FOUND_RESULT } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import {
  makeMockFullPage,
  makeMockMediator,
} from '../../../Scrapers/Pipeline/MockPipelineFactories.js';

/** URLs used by the target-resolution regression tests. */
const STRAY_TRANSACTION_HREF = 'https://web.example.co.il/transactions';

/**
 * Build a page whose locator count supports dashboard candidate counting.
 * Uses {@link makeMockFullPage} and overrides locator with a count stub.
 *
 * @returns Mock page with a deterministic single target count.
 */
function makeDashboardPage(): Page {
  const page = makeMockFullPage('https://web.example.co.il/dashboard');
  const oneLocator = {
    /**
     * Return one match for dashboard candidate expansion.
     * @returns Resolved count of one.
     */
    count: (): Promise<number> => Promise.resolve(1),
  };
  return {
    ...page,
    /**
     * Return count locator stub for dashboard target sizing.
     * @returns One-match locator.
     */
    locator: () => oneLocator,
  } as unknown as Page;
}

/**
 * Build a found href result that carries the supplied snapshot value.
 *
 * @param value - Href snapshot returned by the mediator.
 * @returns Found race result with a href snapshot.
 */
function makeHrefResult(value: string): IRaceResult {
  return { ...NOT_FOUND_RESULT, found: true, value };
}

/**
 * Build a hit-test-passing dashboard click race result.
 *
 * @param page - Page context that owns the resolved element.
 * @returns Found race result with semantic transaction nav identity.
 */
function makeClickResult(page: Page): IRaceResult {
  const locator = { __testLocator: true } as unknown as IRaceResult['locator'];
  const candidate = { kind: 'ariaLabel' as const, value: 'עסקאות' };
  const identity = {
    tag: 'BUTTON',
    id: '',
    classes: '',
    name: '',
    type: '',
    ariaLabel: 'עסקאות',
    title: '',
    href: '',
  };
  return { found: true, locator, candidate, context: page, index: 37, value: 'עסקאות', identity };
}

/**
 * Build a mediator with scripted visible results and href collection.
 *
 * @param results - Ordered resolveVisible responses.
 * @param hrefs - DOM hrefs returned by the brute-scan layer.
 * @returns Mediator whose probe order is deterministic.
 */
function makeDashboardMediator(
  results: readonly IRaceResult[],
  hrefs: readonly string[] = [STRAY_TRANSACTION_HREF],
): IElementMediator {
  const queue = [...results];
  return makeMockMediator({
    /**
     * Return the next scripted visible-result response.
     *
     * @returns Next race result or not-found when exhausted.
     */
    resolveVisible: function resolveVisible(): Promise<IRaceResult> {
      return Promise.resolve(queue.shift() ?? NOT_FOUND_RESULT);
    },
    /**
     * Return scripted DOM hrefs for the brute-scan fallback.
     *
     * @returns Hrefs available in the synthetic dashboard DOM.
     */
    collectAllHrefs: function collectAllHrefs(): Promise<readonly string[]> {
      return Promise.resolve(hrefs);
    },
    /**
     * Return the synthetic dashboard URL used for relative href resolution.
     *
     * @returns Current dashboard URL.
     */
    getCurrentUrl: function getCurrentUrl(): string {
      return 'https://web.example.co.il/dashboard';
    },
  });
}

/**
 * Build the mediator shape from the SPA-no-href dashboard regression.
 *
 * @param page - Page context returned by the click race.
 * @returns Mediator with empty precise hrefs, a clickable target, and a stray href.
 */
function makeSpaNoHrefMediator(page: Page): IElementMediator {
  const results = [makeHrefResult(''), makeHrefResult(''), makeClickResult(page)];
  return makeDashboardMediator(results);
}

/**
 * Build a mediator for precise href extraction tests.
 *
 * @param l1Href - Layer 1 href snapshot.
 * @param l2Href - Layer 2 href snapshot.
 * @returns Mediator with scripted precise href layers.
 */
function makePreciseHrefMediator(l1Href: string, l2Href: string): IElementMediator {
  return makeDashboardMediator([makeHrefResult(l1Href), makeHrefResult(l2Href)]);
}

describe('resolveDashboardTargets — SPA no-href transaction control', () => {
  it('TC-DASH-TARGET-001 prefers the in-SPA click over a stray brute href', async () => {
    const page = makeDashboardPage();
    const mediator = makeSpaNoHrefMediator(page);

    const targets = await resolveDashboardTargets(mediator, page);

    expect(targets.hrefTarget).toBe('');
    expect(targets.clickTarget).not.toBe(false);
  });

  it('TC-DASH-TARGET-002 uses brute href only after click and menu miss', async () => {
    const page = makeDashboardPage();
    const results = [makeHrefResult(''), makeHrefResult(''), NOT_FOUND_RESULT, NOT_FOUND_RESULT];
    const mediator = makeDashboardMediator(results);

    const targets = await resolveDashboardTargets(mediator, page);

    expect(targets.hrefTarget).toBe(STRAY_TRANSACTION_HREF);
    expect(targets.clickTarget).toBe(false);
  });
});

describe('extractTransactionHrefPrecise', () => {
  it('TC-DASH-HREF-001 returns a Layer 1 transaction href', async () => {
    const mediator = makePreciseHrefMediator(
      'https://bank.example/current-account/transactions',
      '',
    );

    const extraction = extractTransactionHrefPrecise(mediator);

    await expect(extraction).resolves.toBe('https://bank.example/current-account/transactions');
  });

  it('TC-DASH-HREF-002 returns a Layer 2 transaction href when Layer 1 is empty', async () => {
    const mediator = makePreciseHrefMediator('', 'https://bank.example/ocp/transactions');

    const extraction = extractTransactionHrefPrecise(mediator);

    await expect(extraction).resolves.toBe('https://bank.example/ocp/transactions');
  });

  it('TC-DASH-HREF-003 ignores brute DOM hrefs when precise layers are empty', async () => {
    const mediator = makePreciseHrefMediator('', '');

    const extraction = extractTransactionHrefPrecise(mediator);

    await expect(extraction).resolves.toBe('');
  });
});

describe('extractHrefLayer3', () => {
  it('TC-DASH-HREF-004 remains available as the brute-scan fallback', async () => {
    const mediator = makeDashboardMediator([]);

    const extraction = extractHrefLayer3(mediator);

    await expect(extraction).resolves.toBe(STRAY_TRANSACTION_HREF);
  });
});

describe('resolveDashboardTargets — same-origin enforcement', () => {
  it('TC-DASH-TARGET-003 rejects cross-origin brute-scan href', async () => {
    const page = makeDashboardPage();
    const results = [makeHrefResult(''), makeHrefResult(''), NOT_FOUND_RESULT, NOT_FOUND_RESULT];
    const mediator = makeDashboardMediator(results, ['https://evil.example/transactions']);

    const targets = await resolveDashboardTargets(mediator, page);

    expect(targets.hrefTarget).toBe('');
    expect(targets.clickTarget).toBe(false);
  });

  it('TC-DASH-TARGET-004 rejects cross-origin precise-layer href', async () => {
    const page = makeDashboardPage();
    const results = [
      makeHrefResult('https://evil.example/transactions'),
      NOT_FOUND_RESULT,
      NOT_FOUND_RESULT,
    ];
    const mediator = makeDashboardMediator(results, []);

    const targets = await resolveDashboardTargets(mediator, page);

    expect(targets.hrefTarget).toBe('');
    expect(targets.clickTarget).toBe(false);
  });
});
