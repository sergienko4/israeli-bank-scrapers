/**
 * Unit tests for DashboardHrefExtraction — triple-threat layer href extraction
 * with TXN_PAGE_PATTERNS filtering.
 */

import { extractTransactionHref } from '../../../../../Scrapers/Pipeline/Mediator/Dashboard/DashboardHrefExtraction.js';
import type {
  IElementMediator,
  IRaceResult,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { NOT_FOUND_RESULT } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';

/** Behaviour toggles for the mock mediator. */
interface IMediatorScript {
  l1Result?: IRaceResult;
  l2Result?: IRaceResult;
  hrefs?: readonly string[];
}

/**
 * Build a mediator that returns scripted race results and href lists.
 * resolveVisible returns l1Result on first call, l2Result on second.
 * @param script - Behaviour script.
 * @returns Mock mediator.
 */
function makeMediator(script: IMediatorScript = {}): IElementMediator {
  let resolveCalls = 0;
  return {
    /**
     * Test helper.
     *
     * @returns Result.
     */
    resolveVisible: (): Promise<IRaceResult> => {
      resolveCalls += 1;
      if (resolveCalls === 1) return Promise.resolve(script.l1Result ?? NOT_FOUND_RESULT);
      return Promise.resolve(script.l2Result ?? NOT_FOUND_RESULT);
    },
    /**
     * Test helper.
     *
     * @returns Result.
     */
    collectAllHrefs: (): Promise<readonly string[]> => Promise.resolve(script.hrefs ?? []),
  } as unknown as IElementMediator;
}

/**
 * Build an IRaceResult with a found href value.
 * @param value - The href value.
 * @returns Populated race result.
 */
function makeFoundResult(value: string): IRaceResult {
  return {
    ...NOT_FOUND_RESULT,
    found: true as const,
    value,
  };
}

describe('extractTransactionHref — Layer 1 aria-label', () => {
  it('returns href from L1 when aria-label candidate matches a txn URL', async () => {
    const href = 'https://bank.co.il/current-account/transactions';
    const mediator = makeMediator({ l1Result: makeFoundResult(href) });
    const out = await extractTransactionHref(mediator);
    expect(out).toBe(href);
  });

  it('filters L1 non-txn href (aria-label hit but URL does not match TXN_PAGE_PATTERNS) → falls to L2', async () => {
    // L1 hits with marketing URL → filterByTxnPattern rejects → falls through.
    const mediator = makeMediator({
      l1Result: makeFoundResult('https://bank.co.il/marketing'),
      l2Result: makeFoundResult('https://bank.co.il/ocp/transactions'),
    });
    const out = await extractTransactionHref(mediator);
    expect(out).toBe('https://bank.co.il/ocp/transactions');
  });

  it('L1 returns empty when not found → tries L2', async () => {
    const mediator = makeMediator({
      l1Result: NOT_FOUND_RESULT,
      l2Result: makeFoundResult('https://bank.co.il/transactions'),
    });
    const out = await extractTransactionHref(mediator);
    expect(out).toBe('https://bank.co.il/transactions');
  });
});

describe('extractTransactionHref — Layer 2 + Layer 3 DOM scan', () => {
  it('falls back to L3 DOM scan when L1 and L2 miss', async () => {
    const mediator = makeMediator({
      l1Result: NOT_FOUND_RESULT,
      l2Result: NOT_FOUND_RESULT,
      hrefs: ['https://bank.co.il/marketing', 'https://bank.co.il/transactions'],
    });
    const out = await extractTransactionHref(mediator);
    expect(out).toBe('https://bank.co.il/transactions');
  });

  it('returns empty string when nothing matches any layer', async () => {
    const mediator = makeMediator({
      l1Result: NOT_FOUND_RESULT,
      l2Result: NOT_FOUND_RESULT,
      hrefs: ['https://bank.co.il/about', 'https://bank.co.il/contact'],
    });
    const out = await extractTransactionHref(mediator);
    expect(out).toBe('');
  });

  it('L2 found but filtered out (non-txn pattern) → falls to L3', async () => {
    const mediator = makeMediator({
      l1Result: NOT_FOUND_RESULT,
      l2Result: makeFoundResult('https://bank.co.il/news'),
      hrefs: ['https://bank.co.il/transactionlist'],
    });
    const out = await extractTransactionHref(mediator);
    expect(out).toBe('https://bank.co.il/transactionlist');
  });

  it('L1 with empty rawHref (race.found=true but value empty) → hits !href guard', async () => {
    // rawHref falsy → filterByTxnPattern returns NO_HREF immediately (line 50 branch).
    const mediator = makeMediator({
      l1Result: { ...NOT_FOUND_RESULT, found: true as const, value: '' },
      l2Result: makeFoundResult('https://bank.co.il/ocp/transactions'),
    });
    const out = await extractTransactionHref(mediator);
    expect(out).toBe('https://bank.co.il/ocp/transactions');
  });
});
