/**
 * Unit tests for visaCalFetchData — mock strategy, guard checks, soft failures.
 * Split from VisaCalScraper.test.ts for the 300-line limit.
 */

import moment from 'moment';
import type { Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import {
  buildMonths,
  visaCalFetchData,
} from '../../../../../../Scrapers/Pipeline/Banks/VisaCal/VisaCalScraper.js';
import type { IFetchStrategy } from '../../../../../../Scrapers/Pipeline/Strategy/FetchStrategy.js';
import { none, some } from '../../../../../../Scrapers/Pipeline/Types/Option.js';
import type { Procedure } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, isOk, succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../../../Pipeline/Infrastructure/MockFactories.js';
import { makeMockBrowserState } from '../../../../Scrapers/Pipeline/MockPipelineFactories.js';

// ── Mock data ─────────────────────────────────────────────

/** Auth JSON stored in sessionStorage. */
const AUTH_JSON = JSON.stringify({ auth: { calConnectToken: 'test-token' } });

/** Init API response — one card. */
const INIT_RESP = { result: { cards: [{ cardUniqueId: 'c1', last4Digits: '1234' }] } };

/** Frames API response — one card frame. */
const FRAMES_RESP = {
  result: { bankIssuedCards: { cardLevelFrames: [{ cardUniqueId: 'c1', nextTotalDebit: 500 }] } },
};

/** Transactions response with data — exercises flatMap callback. */
const TXN_RESP_WITH_DATA = {
  statusCode: 0,
  result: {
    bankAccounts: [
      {
        debitDates: [
          {
            transactions: [
              {
                trnIntId: 'T1',
                trnPurchaseDate: '2026-03-01',
                debCrdDate: '2026-04-01',
                trnAmt: 100,
                amtBeforeConvAndIndex: 100,
                trnCurrencySymbol: 'ILS',
                debCrdCurrencySymbol: 'ILS',
                merchantName: 'Test',
                transTypeCommentDetails: '',
                branchCodeDesc: '',
                trnTypeCode: 5,
                numOfPayments: 0,
                curPaymentNum: 0,
              },
            ],
          },
        ],
        immidiateDebits: { debitDays: [] },
      },
    ],
  },
};

/** Empty transactions response. */
const TXN_RESP = {
  statusCode: 0,
  result: { bankAccounts: [{ debitDates: [], immidiateDebits: { debitDays: [] } }] },
};

/** Empty pending response. */
const PENDING_RESP = { statusCode: 0, result: { cardsList: [{ authDetalisList: [] }] } };

/** Frames response with null bankIssuedCards. */
const FRAMES_NULL_RESP = { result: {} };

/** Pending response with null result. */
const PENDING_NULL_RESP = { statusCode: 0 };

// ── Mock factories ────────────────────────────────────────

/**
 * Create a mock page whose evaluate returns a fixed string.
 * @param evalResult - String returned by page.evaluate.
 * @returns Mock Page.
 */
function makeMockEvalPage(evalResult: string): Page {
  return {
    /**
     * Return fixed eval result.
     * @returns Resolved evalResult.
     */
    evaluate: (): Promise<string> => Promise.resolve(evalResult),
  } as unknown as Page;
}

/**
 * Create a fetch strategy that returns responses sequentially.
 * @param responses - Ordered list of Procedure responses.
 * @returns Mock IFetchStrategy.
 */
function makeSequentialStrategy(responses: Procedure<object>[]): IFetchStrategy {
  let callIndex = 0;
  return {
    /**
     * Return next queued response.
     * @returns Next Procedure from queue.
     */
    fetchPost: <T>(): Promise<Procedure<T>> => {
      const idx = callIndex;
      callIndex += 1;
      const resp = responses[idx] ?? fail(ScraperErrorTypes.Generic, 'No more responses');
      return Promise.resolve(resp as Procedure<T>);
    },
    /**
     * Not used by VisaCal.
     * @returns Failure.
     */
    fetchGet: <T>(): Promise<Procedure<T>> => {
      const result = fail(ScraperErrorTypes.Generic, 'Not used');
      return Promise.resolve(result as Procedure<T>);
    },
  };
}

/**
 * Build a pipeline context for visaCalFetchData tests.
 * @param strategy - Fetch strategy to inject.
 * @param startDate - Start date for month range (default: now).
 * @returns IPipelineContext with browser + strategy.
 */
function makeVisaCalCtx(
  strategy: IFetchStrategy,
  startDate = new Date(),
): ReturnType<typeof makeMockContext> {
  const page = makeMockEvalPage(AUTH_JSON);
  const browserState = makeMockBrowserState(page);
  const mockApi = {
    base: '',
    purchaseHistory: '',
    card: '',
    calInit: 'https://api.cal/init',
    calFrames: 'https://api.cal/frames',
    calTransactions: 'https://api.cal/txn',
    calPending: 'https://api.cal/pending',
    calXSiteId: 'test-site-id',
    calOrigin: 'https://cal-online.co.il',
    calLoginResponse: '',
    calEncKey: '',
  };
  return makeMockContext({
    browser: some(browserState),
    fetchStrategy: some(strategy),
    options: { startDate, companyId: 'visaCal' as never },
    config: { urls: { base: '', loginRoute: '', transactions: '' }, api: mockApi } as never,
  });
}

// ── visaCalFetchData tests ────────────────────────────────

describe('visaCalFetchData', () => {
  it('fails when browser is absent', async () => {
    const noBrowser = none();
    const ctx = makeMockContext({ browser: noBrowser });
    const result = await visaCalFetchData(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(false);
  });

  it('fails when fetchStrategy is absent', async () => {
    const page = makeMockEvalPage(AUTH_JSON);
    const browserState = makeMockBrowserState(page);
    const noStrategy = none();
    const browserSome = some(browserState);
    const ctx = makeMockContext({ browser: browserSome, fetchStrategy: noStrategy });
    const result = await visaCalFetchData(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(false);
  });

  it('propagates fetchCards failure', async () => {
    const initFail = fail(ScraperErrorTypes.Generic, 'init failed');
    const strategy = makeSequentialStrategy([initFail]);
    const ctx = makeVisaCalCtx(strategy);
    const result = await visaCalFetchData(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(false);
  });

  it('propagates fetchFrames failure', async () => {
    const initOk = succeed(INIT_RESP);
    const framesFail = fail(ScraperErrorTypes.Generic, 'frames failed');
    const strategy = makeSequentialStrategy([initOk, framesFail]);
    const ctx = makeVisaCalCtx(strategy);
    const result = await visaCalFetchData(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(false);
  });

  it('returns accounts on full success with transactions', async () => {
    const now = moment();
    const months = buildMonths(now, 0);
    const monthCount = months.length;
    const txnResponses = Array.from({ length: monthCount }, () => succeed(TXN_RESP_WITH_DATA));
    const initOk = succeed(INIT_RESP);
    const framesOk = succeed(FRAMES_RESP);
    const pendingOk = succeed(PENDING_RESP);
    const responses = [initOk, framesOk, ...txnResponses, pendingOk];
    const strategy = makeSequentialStrategy(responses as Procedure<object>[]);
    const ctx = makeVisaCalCtx(strategy);
    const result = await visaCalFetchData(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    if (!wasOk) return;
    const hasScrape = result.value.scrape.has;
    expect(hasScrape).toBe(true);
  });

  it('handles null bankIssuedCards in frames response', async () => {
    const now = moment();
    const months = buildMonths(now, 0);
    const txnResponses = Array.from({ length: months.length }, () => succeed(TXN_RESP));
    const responses = [
      succeed(INIT_RESP),
      succeed(FRAMES_NULL_RESP),
      ...txnResponses,
      succeed(PENDING_RESP),
    ];
    const strategy = makeSequentialStrategy(responses as Procedure<object>[]);
    const ctx = makeVisaCalCtx(strategy);
    const result = await visaCalFetchData(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('handles null result in pending response', async () => {
    const now = moment();
    const months = buildMonths(now, 0);
    const txnResponses = Array.from({ length: months.length }, () => succeed(TXN_RESP));
    const responses = [
      succeed(INIT_RESP),
      succeed(FRAMES_RESP),
      ...txnResponses,
      succeed(PENDING_NULL_RESP),
    ];
    const strategy = makeSequentialStrategy(responses as Procedure<object>[]);
    const ctx = makeVisaCalCtx(strategy);
    const result = await visaCalFetchData(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('continues when pending fetch fails', async () => {
    const now = moment();
    const months = buildMonths(now, 0);
    const txnResponses = Array.from({ length: months.length }, () => succeed(TXN_RESP));
    const pendingFail = fail(ScraperErrorTypes.Generic, 'pending failed');
    const responses = [succeed(INIT_RESP), succeed(FRAMES_RESP), ...txnResponses, pendingFail];
    const strategy = makeSequentialStrategy(responses as Procedure<object>[]);
    const ctx = makeVisaCalCtx(strategy);
    const result = await visaCalFetchData(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('continues with remaining months when one month fails', async () => {
    const twoMonthsAgo = moment().subtract(2, 'months').toDate();
    const startMoment = moment(twoMonthsAgo);
    const months = buildMonths(startMoment, 0);
    const monthCount = months.length;
    const monthFail = fail(ScraperErrorTypes.Generic, 'month failed');
    const txnResponses: Procedure<object>[] = [monthFail];
    const remainingSuccesses = Array.from({ length: monthCount - 1 }, () => succeed(TXN_RESP));
    txnResponses.push(...remainingSuccesses);
    const initOk = succeed(INIT_RESP);
    const framesOk = succeed(FRAMES_RESP);
    const pendingOk = succeed(PENDING_RESP);
    const allResponses: Procedure<object>[] = [initOk, framesOk, ...txnResponses, pendingOk];
    const strategy = makeSequentialStrategy(allResponses);
    const ctx = makeVisaCalCtx(strategy, twoMonthsAgo);
    const result = await visaCalFetchData(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });
});
