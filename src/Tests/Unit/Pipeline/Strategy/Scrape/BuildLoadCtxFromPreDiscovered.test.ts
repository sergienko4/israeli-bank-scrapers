/**
 * Coverage for `buildLoadCtxFromPreDiscovered` — the helper SCRAPE.PRE
 * uses to build the matrix-loop context from pre-discovered accounts.
 *
 * Three branches matter:
 * - `ids.length > 0` → use the pre-discovered list directly.
 * - `ids.length === 0` AND POST-body fallback hits → use fallback.
 * - `ids.length === 0` AND fallback misses → return empty ids.
 */

import { buildLoadCtxFromPreDiscovered } from '../../../../../Scrapers/Pipeline/Strategy/Scrape/GenericAutoScrapeStrategy.js';
import { makeApi, makeEndpoint, makeFc, makeNetwork } from '../StrategyTestHelpers.js';

describe('buildLoadCtxFromPreDiscovered', () => {
  it('uses pre-discovered ids when supplied (no rediscovery, no fallback)', () => {
    const api = makeApi();
    const txnEp = makeEndpoint({
      method: 'POST',
      postData: '{"cardUniqueId":"FALLBACK-CARD"}',
    });
    const network = makeNetwork({
      /**
       * Test helper.
       * @returns Test endpoint.
       */
      discoverTransactionsEndpoint: () => txnEp,
    });
    const fc = makeFc(api, network);
    const result = buildLoadCtxFromPreDiscovered({
      fc,
      network,
      ids: ['PRE-DISCOVERED-1'],
      records: [{ accountId: 'PRE-DISCOVERED-1' }],
    });
    expect(result.ids).toEqual(['PRE-DISCOVERED-1']);
    expect(result.ids).not.toContain('FALLBACK-CARD');
  });

  it('falls back to txn POST body when ids empty and POST body has cardUniqueId', () => {
    const api = makeApi();
    const txnEp = makeEndpoint({
      method: 'POST',
      postData: '{"cardUniqueId":"FALLBACK-CARD"}',
    });
    const network = makeNetwork({
      /**
       * Test helper.
       * @returns Test endpoint.
       */
      discoverTransactionsEndpoint: () => txnEp,
    });
    const fc = makeFc(api, network);
    const result = buildLoadCtxFromPreDiscovered({
      fc,
      network,
      ids: [],
      records: [],
    });
    expect(result.ids).toContain('FALLBACK-CARD');
  });

  it('returns empty ids when ids empty AND POST-body fallback misses', () => {
    const api = makeApi();
    const txnEp = makeEndpoint({
      method: 'GET',
      postData: '',
    });
    const network = makeNetwork({
      /**
       * Test helper.
       * @returns Test endpoint.
       */
      discoverTransactionsEndpoint: () => txnEp,
    });
    const fc = makeFc(api, network);
    const result = buildLoadCtxFromPreDiscovered({
      fc,
      network,
      ids: [],
      records: [],
    });
    expect(result.ids.length).toBe(0);
    expect(result.records.length).toBe(0);
  });

  it('still returns empty ids when txnEndpoint is false', () => {
    const api = makeApi();
    const network = makeNetwork({
      /**
       * Test helper.
       * @returns False (no txn endpoint discovered).
       */
      discoverTransactionsEndpoint: () => false,
    });
    const fc = makeFc(api, network);
    const result = buildLoadCtxFromPreDiscovered({
      fc,
      network,
      ids: [],
      records: [],
    });
    expect(result.ids.length).toBe(0);
    expect(result.txnEndpoint).toBe(false);
  });
});
