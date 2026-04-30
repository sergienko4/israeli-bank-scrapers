/**
 * Branch recovery #3 for AccountScrapeStrategy.
 * Targets:
 *   - L189 matrix !== false truthy: tryMatrixLoop returns an account
 *     (Network.discoverTransactionsEndpoint returns a monthly postData endpoint,
 *      and fetchPost returns a body with transactions)
 *   - L191 billing isOk true + >0 txns: billing returns a result with txns
 *   - L191 billing isOk true + 0 txns: billing returns a 0-txn result
 *   - L100 rawRecord undefined: scrapePostDirect called without rawRecord
 */

import type { IDiscoveredEndpoint } from '../../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import {
  scrapeOneAccountPost,
  tryBufferedResponse,
} from '../../../../../../Scrapers/Pipeline/Strategy/Scrape/Account/AccountScrapeStrategy.js';
import type { IPostFetchCtx } from '../../../../../../Scrapers/Pipeline/Strategy/Scrape/ScrapeTypes.js';
import { isOk } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  makeApi,
  makeEndpoint,
  makeFc,
  makeNetwork,
  stubFetchPostOk,
} from '../../StrategyTestHelpers.js';

describe('AccountScrapeStrategy — branch recovery #3', () => {
  it('tryBufferedResponse: rawRecord undefined → fallback-to-body branch', async () => {
    // Hits L164 `rawRecord ?? body` — rawRecord is undefined so body wins.
    const api = makeApi();
    const network = makeNetwork();
    const fc = makeFc(api, network);
    const endpoint = makeEndpoint({
      responseBody: { transactions: [{ date: '2026-01-15', amount: -50 }] },
    });
    const postCtx: IPostFetchCtx = {
      baseBody: {},
      url: 'https://bank.example/api/txn',
      displayId: 'A',
      accountId: 'ACC',
    };
    // Explicitly omit rawRecord from the attempt ctx.
    const result = await tryBufferedResponse(fc, { endpoint, postCtx });
    const isProc = result !== false;
    expect(isProc).toBe(true);
    if (result !== false) {
      const isOkResult = isOk(result);
      expect(isOkResult).toBe(true);
    }
  });

  it('scrapeOneAccountPost: matrix endpoint returns txns → L189 matrix !== false truthy path', async () => {
    // Monthly endpoint: postData contains month+year WK fields.
    // fetchPost returns a body with transactions → tryMatrixLoop succeeds.
    const matrixEp: IDiscoveredEndpoint = makeEndpoint({
      url: 'https://bank.example/api/txn',
      method: 'POST',
      postData: '{"cardUniqueId":"CARD1","month":1,"year":2026}',
      responseBody: undefined,
    });
    const postOk = stubFetchPostOk({
      result: { transactions: [{ date: '2026-01-10', amount: -75 }] },
    });
    const api = makeApi({ fetchPost: postOk });
    const network = makeNetwork({
      /**
       * Return monthly endpoint template.
       * @returns The matrix endpoint.
       */
      discoverTransactionsEndpoint: () => matrixEp,
    });
    const fc = makeFc(api, network, '20260101');
    const accountRecord = { cardUniqueId: 'CARD1' };
    const result = await scrapeOneAccountPost(fc, accountRecord, matrixEp);
    // Matrix path succeeded — returned an account procedure (not false).
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
  });

  it('scrapeOneAccountPost: matrix/billing all empty → direct POST with rawRecord passthrough', async () => {
    // No monthly postData, billing can't fallback, isRangeIterable=false →
    // scrapePostDirect is called with rawRecord=accountRecord.
    const postOk = stubFetchPostOk({ data: [] });
    const api = makeApi({ fetchPost: postOk });
    const network = makeNetwork();
    const fc = makeFc(api, network);
    const endpoint = makeEndpoint({
      url: 'https://bank.example/api/txn',
      method: 'POST',
      postData: '{"id":"a","startDate":"20260101"}',
      responseBody: undefined,
    });
    const accountRecord = { accountId: 'a' };
    const result = await scrapeOneAccountPost(fc, accountRecord, endpoint);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
  });
});
