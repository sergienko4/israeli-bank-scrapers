/**
 * Branch recovery #3 for AccountScrapeStrategy.
 * Phase 7f: covers the matrix-success path and the direct-POST
 * passthrough; the legacy `tryBufferedResponse` recovery test is
 * removed because the function was deleted to honour 100%
 * SCRAPE/network separation (R-NET-SCRAPE).
 */

import { scrapeOneAccountPost } from '../../../../../../Scrapers/Pipeline/Strategy/Scrape/Account/AccountScrapeStrategy.js';
import { isOk } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  makeApi,
  makeEndpoint,
  makeFc,
  makeNetwork,
  stubFetchPostOk,
} from '../../StrategyTestHelpers.js';

describe('AccountScrapeStrategy — branch recovery #3', () => {
  it('scrapeOneAccountPost: matrix endpoint returns txns → matrix-success branch', async () => {
    // Monthly endpoint: templatePostData contains month+year WK fields.
    // fetchPost returns a body with transactions → tryMatrixLoop succeeds.
    const matrixEp = makeEndpoint({
      url: 'https://bank.example/api/txn',
      method: 'POST',
      postData: '{"cardUniqueId":"CARD1","month":1,"year":2026}',
      responseBody: undefined,
    });
    const postOk = stubFetchPostOk({
      result: { transactions: [{ date: '2026-01-10', amount: -75 }] },
    });
    const api = makeApi({ fetchPost: postOk });
    const network = makeNetwork();
    const fc = makeFc(api, network, { startDate: '20260101', txnEndpoint: matrixEp });
    const accountRecord = { cardUniqueId: 'CARD1' };
    const result = await scrapeOneAccountPost(fc, accountRecord);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
  });

  it('scrapeOneAccountPost: matrix/billing empty → direct POST with rawRecord passthrough', async () => {
    // No monthly postData, billing can't fallback, isRangeIterable=false →
    // scrapePostDirect is called with rawRecord=accountRecord.
    const postOk = stubFetchPostOk({ data: [] });
    const api = makeApi({ fetchPost: postOk });
    const network = makeNetwork();
    const endpoint = makeEndpoint({
      url: 'https://bank.example/api/txn',
      method: 'POST',
      postData: '{"id":"a","startDate":"20260101"}',
      responseBody: undefined,
    });
    const fc = makeFc(api, network, { txnEndpoint: endpoint });
    const accountRecord = { accountId: 'a' };
    const result = await scrapeOneAccountPost(fc, accountRecord);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
  });
});
