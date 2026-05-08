/**
 * Coverage for `buildLoadCtxFromPreDiscovered` — Phase 7c contract:
 * SCRAPE consumes `ctx.accountDiscovery` from ACCOUNT-RESOLVE only.
 *
 * Two branches:
 * - `ids` non-empty → pass-through; txn endpoint discovered separately.
 * - `ids` empty → return empty load context (caller fail-fast).
 */

import { EMPTY_TXN_HARVEST } from '../../../../../Scrapers/Pipeline/Mediator/Dashboard/TxnParser.js';
import { buildLoadCtxFromPreDiscovered } from '../../../../../Scrapers/Pipeline/Strategy/Scrape/GenericAutoScrapeStrategy.js';
import { EMPTY_TXN_ENDPOINT } from '../../../../../Scrapers/Pipeline/Strategy/Scrape/ScrapeTypes.js';
import type { ITxnEndpoint } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { makeApi, makeFc, makeNetwork } from '../StrategyTestHelpers.js';

const STUB_TXN_ENDPOINT: ITxnEndpoint = {
  ...EMPTY_TXN_ENDPOINT,
  url: 'https://bank.fake.example/api/txn',
  method: 'POST',
  templatePostData: '{"cardUniqueId":"FAKE-CARD-1"}',
};

describe('buildLoadCtxFromPreDiscovered (Phase 7f — slim ITxnEndpoint contract)', () => {
  it('uses pre-discovered ids verbatim when supplied', () => {
    const api = makeApi();
    const network = makeNetwork({});
    const fc = makeFc(api, network);
    const result = buildLoadCtxFromPreDiscovered({
      fc,
      txnEndpoint: STUB_TXN_ENDPOINT,
      harvest: EMPTY_TXN_HARVEST,
      ids: ['PRE-DISCOVERED-1'],
      records: [{ accountId: 'PRE-DISCOVERED-1' }],
    });
    expect(result.ids).toEqual(['PRE-DISCOVERED-1']);
    expect(result.ids).not.toContain('WOULD-BE-FALLBACK');
  });

  it('returns empty load context when ids empty (no fallback path)', () => {
    const api = makeApi();
    const network = makeNetwork({});
    const fc = makeFc(api, network);
    const result = buildLoadCtxFromPreDiscovered({
      fc,
      txnEndpoint: STUB_TXN_ENDPOINT,
      harvest: EMPTY_TXN_HARVEST,
      ids: [],
      records: [],
    });
    expect(result.ids.length).toBe(0);
    expect(result.records.length).toBe(0);
  });

  it('returns empty load context when txnEndpoint is the EMPTY default', () => {
    const api = makeApi();
    const network = makeNetwork({});
    const fc = makeFc(api, network);
    const result = buildLoadCtxFromPreDiscovered({
      fc,
      txnEndpoint: EMPTY_TXN_ENDPOINT,
      harvest: EMPTY_TXN_HARVEST,
      ids: [],
      records: [],
    });
    expect(result.ids.length).toBe(0);
    expect(result.txnEndpoint?.url).toBe('');
  });
});
