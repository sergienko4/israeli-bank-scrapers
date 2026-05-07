/**
 * Coverage for `buildLoadCtxFromPreDiscovered` — Phase 7c contract:
 * SCRAPE consumes `ctx.accountDiscovery` from ACCOUNT-RESOLVE only.
 *
 * Two branches:
 * - `ids` non-empty → pass-through; txn endpoint discovered separately.
 * - `ids` empty → return empty load context (caller fail-fast).
 */

import { buildLoadCtxFromPreDiscovered } from '../../../../../Scrapers/Pipeline/Strategy/Scrape/GenericAutoScrapeStrategy.js';
import { makeApi, makeEndpoint, makeFc, makeNetwork } from '../StrategyTestHelpers.js';

describe('buildLoadCtxFromPreDiscovered (Phase 7e — txnEndpoint is supplied, not discovered)', () => {
  it('uses pre-discovered ids verbatim when supplied', () => {
    const api = makeApi();
    const txnEp = makeEndpoint({
      method: 'POST',
      postData: '{"cardUniqueId":"WOULD-BE-FALLBACK"}',
    });
    const network = makeNetwork({});
    const fc = makeFc(api, network);
    const result = buildLoadCtxFromPreDiscovered({
      fc,
      txnEndpoint: txnEp,
      ids: ['PRE-DISCOVERED-1'],
      records: [{ accountId: 'PRE-DISCOVERED-1' }],
    });
    expect(result.ids).toEqual(['PRE-DISCOVERED-1']);
    expect(result.ids).not.toContain('WOULD-BE-FALLBACK');
  });

  it('returns empty load context when ids empty (no fallback path)', () => {
    const api = makeApi();
    const txnEp = makeEndpoint({
      method: 'POST',
      postData: '{"cardUniqueId":"NO-LONGER-USED"}',
    });
    const network = makeNetwork({});
    const fc = makeFc(api, network);
    const result = buildLoadCtxFromPreDiscovered({
      fc,
      txnEndpoint: txnEp,
      ids: [],
      records: [],
    });
    expect(result.ids.length).toBe(0);
    expect(result.records.length).toBe(0);
  });

  it('returns empty load context when txnEndpoint is also false', () => {
    const api = makeApi();
    const network = makeNetwork({});
    const fc = makeFc(api, network);
    const result = buildLoadCtxFromPreDiscovered({
      fc,
      txnEndpoint: false,
      ids: [],
      records: [],
    });
    expect(result.ids.length).toBe(0);
    expect(result.txnEndpoint).toBe(false);
  });
});
