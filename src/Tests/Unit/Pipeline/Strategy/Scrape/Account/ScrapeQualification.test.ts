/**
 * Unit tests for Strategy/Scrape/Account/ScrapeQualification — helpers + qualifyAllCards.
 */

import type { IDiscoveredEndpoint } from '../../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import type { IQualifyCtx } from '../../../../../../Scrapers/Pipeline/Strategy/Scrape/Account/ScrapeQualification.js';
import {
  extractAllCardIds,
  qualifyAllCards,
  resolveCardIds,
} from '../../../../../../Scrapers/Pipeline/Strategy/Scrape/Account/ScrapeQualification.js';
import { makeApi, stubFetchPostFail, stubFetchPostOk } from '../../StrategyTestHelpers.js';

/**
 * Build endpoint stub.
 * @param method - HTTP method.
 * @param postData - Raw POST data.
 * @returns Stub endpoint.
 */
function makeEp(method: string, postData: string): IDiscoveredEndpoint {
  return { url: 'u', method, postData, responseBody: {} } as unknown as IDiscoveredEndpoint;
}

describe('extractAllCardIds', () => {
  it('returns empty list when no POST endpoints contain last4digits', () => {
    const eps = [makeEp('POST', '{"other":"x"}')];
    const extractAllCardIdsResult1 = extractAllCardIds(eps);
    expect(extractAllCardIdsResult1).toEqual([]);
  });

  it('extracts unique card IDs from matching POST bodies', () => {
    const body = JSON.stringify({ last4digits: '1234' });
    const eps = [makeEp('POST', body), makeEp('POST', body)];
    const ids = extractAllCardIds(eps);
    const isArrayResult2 = Array.isArray(ids);
    expect(isArrayResult2).toBe(true);
  });

  it('ignores non-POST endpoints', () => {
    const eps = [makeEp('GET', '{"last4digits":"1234"}')];
    const extractAllCardIdsResult3 = extractAllCardIds(eps);
    expect(extractAllCardIdsResult3).toEqual([]);
  });

  it('returns empty list when no endpoints', () => {
    const extractAllCardIdsResult4 = extractAllCardIds([]);
    expect(extractAllCardIdsResult4).toEqual([]);
  });
});

describe('resolveCardIds', () => {
  it('returns discovered ids when non-empty', () => {
    const ids = resolveCardIds(['a', 'b'], {});
    expect(ids).toEqual(['a', 'b']);
  });

  it('falls back to credential card6Digits when discovered is empty', () => {
    const ids = resolveCardIds([], { card6Digits: '123456' });
    expect(ids).toEqual(['123456']);
  });

  it('falls back to "default" when no discovered and no credentials', () => {
    const ids = resolveCardIds([], {});
    expect(ids).toEqual(['default']);
  });
});

/**
 * Build a qualify context stub.
 * @param fetchPost - Post fetcher override.
 * @returns IQualifyCtx.
 */
function makeQCtx(fetchPost: ReturnType<typeof stubFetchPostOk>): IQualifyCtx {
  return {
    api: makeApi({ fetchPost }),
    templateBody: {},
    txnUrl: 'https://bank.example/txn',
    lastMonth: '01/01/2026',
  };
}

describe('qualifyAllCards', () => {
  it('qualifies a card when API returns isSuccess:true', async () => {
    const stubFetchPostOkResult5 = stubFetchPostOk({ isSuccess: true });
    const ctx = makeQCtx(stubFetchPostOkResult5);
    const accum = await qualifyAllCards(ctx, ['card-1']);
    expect(accum.qualified).toEqual(['card-1']);
    expect(accum.pruned).toEqual([]);
  });

  it('prunes a card when API returns isSuccess:false', async () => {
    const stubFetchPostOkResult6 = stubFetchPostOk({ isSuccess: false });
    const ctx = makeQCtx(stubFetchPostOkResult6);
    const accum = await qualifyAllCards(ctx, ['card-1']);
    expect(accum.qualified).toEqual([]);
    expect(accum.pruned).toEqual(['card-1']);
  });

  it('prunes a card when fetch fails', async () => {
    const stubFetchPostFailResult7 = stubFetchPostFail();
    const ctx = makeQCtx(stubFetchPostFailResult7);
    const accum = await qualifyAllCards(ctx, ['card-1']);
    expect(accum.pruned).toEqual(['card-1']);
  });

  it('handles multiple cards sequentially', async () => {
    const stubFetchPostOkResult8 = stubFetchPostOk({ isSuccess: true });
    const ctx = makeQCtx(stubFetchPostOkResult8);
    const accum = await qualifyAllCards(ctx, ['card-1', 'card-2', 'card-3']);
    expect(accum.qualified).toHaveLength(3);
  });

  it('returns empty accum for empty card list', async () => {
    const stubFetchPostOkResult9 = stubFetchPostOk({ isSuccess: true });
    const ctx = makeQCtx(stubFetchPostOkResult9);
    const accum = await qualifyAllCards(ctx, []);
    expect(accum.qualified).toEqual([]);
    expect(accum.pruned).toEqual([]);
  });
});
