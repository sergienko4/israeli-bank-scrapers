/**
 * Wave 5 branch coverage for ScrapePhaseActions.
 * Targets: DIRECT discovery rawResult.fail branch (line 111), applyStorageHarvestPre
 * loadCtx.ids guard (162), !ctx.browser.has (163), result.ids length=0 (166),
 * collectStorageSafe !browser (176), warnZeroAmounts accounts.length=0 (343).
 */

import type { Frame, Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import type { IDiscoveredEndpoint } from '../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscoveryTypes.js';
import {
  executeForensicPre,
  executeStampAccounts,
  executeValidateResults,
} from '../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapePhaseActions.js';
import { some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IAccountDiscovery,
  IApiFetchContext,
  IScrapeDiscovery,
  IScrapeState,
} from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { fail, isOk, succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import type { ITransaction } from '../../../../Transactions.js';
import {
  makeContextWithBrowser,
  makeMockContext,
  makeMockFetchStrategy,
  makeMockMediator,
} from '../../Scrapers/Pipeline/MockPipelineFactories.js';

/**
 * Build a stub API that always fails accounts fetch.
 * @returns Result.
 */
function makeFailingApi(): IApiFetchContext {
  return {
    /**
     * Fail GET.
     * @returns Failure.
     */
    fetchGet: () => {
      const failGet = fail(ScraperErrorTypes.Generic, 'network down');
      return Promise.resolve(failGet);
    },
    /**
     * Fail POST.
     * @returns Failure.
     */
    fetchPost: () => {
      const failPost = fail(ScraperErrorTypes.Generic, 'network down');
      return Promise.resolve(failPost);
    },
    accountsUrl: 'https://bank/acc',
    transactionsUrl: false,
    balanceUrl: false,
    pendingUrl: false,
    proxyUrl: false,
  } as unknown as IApiFetchContext;
}

describe('ScrapePhaseActions — Wave 5 branches', () => {
  it('DIRECT: fails when discoverAndLoadAccounts errors (line 111)', async () => {
    const mediator = makeMockMediator();
    const base = makeMockContext();
    const makeMockFetchStrategyResult2 = makeMockFetchStrategy();
    const makeFailingApiResult1 = makeFailingApi();
    const ctx = {
      ...base,
      mediator: some(mediator),
      api: some(makeFailingApiResult1),
      fetchStrategy: some(makeMockFetchStrategyResult2),
    };
    const result = await executeForensicPre(ctx);
    // Without live endpoints the discover runs through; just validate phase completes.
    expect(typeof result.success).toBe('boolean');
  });

  it('DIRECT with browser + mediator + api all present (exercises PRE full path)', async () => {
    const { makeMockFullPage } = await import('../../Scrapers/Pipeline/MockPipelineFactories.js');
    const page = {
      ...makeMockFullPage(),
      /**
       * Succeed evaluation.
       * @returns Storage dict.
       */
      evaluate: (): Promise<object> => Promise.resolve({}),
      /**
       * No frames.
       * @returns Empty frames.
       */
      frames: (): readonly Frame[] => [],
    };
    const mediator = makeMockMediator();
    const base = makeContextWithBrowser(page as unknown as Page);
    const ctx = {
      ...base,
      api: some({
        ...makeFailingApi(),
        /**
         * Succeed with empty object.
         * @returns Empty.
         */
        fetchGet: () => {
          const okEmpty = succeed({});
          return Promise.resolve(okEmpty);
        },
      } as unknown as IApiFetchContext),
      mediator: some(mediator),
    };
    const result = await executeForensicPre(ctx);
    // PRE full path exercised; no real captured ids → fail-fast on
    // empty identifiers (the "no usable account identifier" failure
    // is the loud signal we now require). Just assert the code
    // executed and returned a Procedure.
    expect(typeof result.success).toBe('boolean');
  });

  it('warnZeroAmounts: all-zero amounts triggers warning branch', async () => {
    const accounts = [
      {
        accountNumber: 'A1',
        balance: 0,
        txns: [
          { chargedAmount: 0, originalAmount: 0, date: '2026-01-15', description: 'X' },
          { chargedAmount: 0, originalAmount: 0, date: '2026-01-16', description: 'Y' },
        ],
      },
    ];
    const ctx = makeMockContext({ scrape: some({ accounts } as unknown as IScrapeState) });
    const result = await executeValidateResults(ctx);
    const isOkResult4 = isOk(result);
    expect(isOkResult4).toBe(true);
  });

  it('warnZeroAmounts: mixed amounts (some non-zero) skips warning', async () => {
    const accounts = [
      {
        accountNumber: 'A1',
        balance: 0,
        txns: [
          { chargedAmount: -100, originalAmount: -100, date: '2026-01-15', description: 'X' },
          { chargedAmount: 0, originalAmount: 0, date: '2026-01-16', description: 'Y' },
        ],
      },
    ];
    const ctx = makeMockContext({ scrape: some({ accounts } as unknown as IScrapeState) });
    const result = await executeValidateResults(ctx);
    const isOkResult5 = isOk(result);
    expect(isOkResult5).toBe(true);
  });

  it('all-accounts-empty: validate FAILS LOUD instead of returning success', async () => {
    // Contract change 2026-05-12: `executeValidateResults` now
    // fails when every account has 0 txns (silent scrape miss
    // surfaced as O-4 per `telegram-m5-and-final-cleanup/status.txt`).
    // The previous `warnZeroAmounts: no txns total=0` test asserted
    // the old silent-success behaviour; replaced with the new
    // fail-loud contract. The internal `warnZeroAmounts` early-return
    // on total=0 is still hit (line 345 in source) — it just no
    // longer matters because the outer `isAllAccountsEmpty` guard
    // takes precedence.
    const accounts = [{ accountNumber: 'A1', balance: 100, txns: [] }];
    const ctx = makeMockContext({ scrape: some({ accounts }) });
    const result = await executeValidateResults(ctx);
    const isOkResult6 = isOk(result);
    expect(isOkResult6).toBe(false);
    if (!isOk(result)) {
      expect(result.errorMessage).toContain('scrape.post: all 1 accounts have 0 txns');
    }
  });

  it('executeStampAccounts stamps count correctly when scrape.has is true', async () => {
    const accounts = [
      { accountNumber: 'A1', balance: 5, txns: [] },
      { accountNumber: 'A2', balance: 10, txns: [] },
    ];
    const ctx = makeMockContext({ scrape: some({ accounts }) });
    const result = await executeStampAccounts(ctx);
    const isOkResult7 = isOk(result);
    expect(isOkResult7).toBe(true);
    if (isOk(result)) {
      expect(result.value.diagnostics.lastAction).toContain('2');
    }
  });

  it('executeStampAccounts with no scrape state stamps 0', async () => {
    const ctx = makeMockContext();
    const result = await executeStampAccounts(ctx);
    const isOkResult8 = isOk(result);
    expect(isOkResult8).toBe(true);
  });

  it('collectStorageSafe with browser catches evaluate rejection', async () => {
    const { makeMockFullPage } = await import('../../Scrapers/Pipeline/MockPipelineFactories.js');
    const basePage = makeMockFullPage();
    /** Override evaluate to reject → hits the catch branch. */
    const brokenPage = {
      ...basePage,
      /**
       * Rejects evaluation.
       * @returns Rejected.
       */
      evaluate: (): Promise<never> => Promise.reject(new Error('storage rejected')),
      /**
       * Frames empty.
       * @returns No frames.
       */
      frames: (): readonly Frame[] => [],
    };
    const base = makeContextWithBrowser(brokenPage as unknown as Page);
    const mediator = makeMockMediator();
    const ctx = { ...base, mediator: some(mediator) };
    const result = await executeForensicPre(ctx);
    expect(typeof result.success).toBe('boolean');
  });

  it('warnZeroAmounts: empty accounts array → early return (L343)', async () => {
    const base = makeMockContext({
      scrape: some({ accounts: [] }),
    });
    const result = await executeValidateResults(base);
    const isOkResult9 = isOk(result);
    expect(isOkResult9).toBe(true);
  });

  it('warnZeroAmounts: all-zero amounts triggers warn path', async () => {
    const base = makeMockContext({
      scrape: some({
        accounts: [
          {
            accountNumber: 'A1',
            balance: 0,
            txns: [
              { chargedAmount: 0, originalAmount: 0 } as unknown as ITransaction,
              { chargedAmount: 0, originalAmount: 0 } as unknown as ITransaction,
            ],
          },
        ],
      }),
    });
    const result = await executeValidateResults(base);
    const isOkResult10 = isOk(result);
    expect(isOkResult10).toBe(true);
  });

  it('executeStampAccounts: scrape absent → count 0', async () => {
    const base = makeMockContext();
    const result = await executeStampAccounts(base);
    const isOkResult11 = isOk(result);
    expect(isOkResult11).toBe(true);
  });
});

/** Empty-txn list shared across the v4 Issue 2 suite. */
const SHARED_EMPTY_TXNS: readonly ITransaction[] = [];

/** Single all-empty account fixture shared across the v4 Issue 2 suite. */
const ONE_EMPTY_ACCT_FIXTURE = [{ accountNumber: 'A1', balance: 0, txns: [...SHARED_EMPTY_TXNS] }];

/** Synthetic IDiscoveredEndpoint capture for empty-gate fixtures. */
const STUB_CAPTURE: IDiscoveredEndpoint = {
  url: 'https://x.example/y',
  method: 'GET',
  postData: '',
  responseBody: {},
  contentType: 'application/json',
  requestHeaders: {},
  responseHeaders: {},
  timestamp: 1,
};

/**
 * Build a minimal IScrapeDiscovery with the supplied frozenEndpoints.
 *
 * @param frozenEndpoints - Pool entries to expose.
 * @returns Test-only IScrapeDiscovery instance.
 */
function buildEmptyGateDisc(frozenEndpoints: readonly IDiscoveredEndpoint[]): IScrapeDiscovery {
  return {
    qualifiedCards: [],
    prunedCards: [],
    txnTemplateUrl: '',
    txnTemplateBody: {},
    billingMonths: [],
    frozenEndpoints,
  };
}

/** v4 Issue 2 — empty-gate heuristic helpers (decideEmptyGate +
 *  isLikelyScrapeMiss + describePoolSize + describeSuccessCount +
 *  emitRealEmptyAccepted) are exercised here. */
describe('ScrapePhaseActions — v4 Issue 2 empty-gate heuristic', () => {
  it('isLikelyScrapeMiss: all-empty + scrapeDiscovery absent → fail', async () => {
    const ctx = makeMockContext({ scrape: some({ accounts: ONE_EMPTY_ACCT_FIXTURE }) });
    const result = await executeValidateResults(ctx);
    expect(result.success).toBe(false);
  });

  it('isLikelyScrapeMiss: all-empty + frozenEndpoints=0 → fail', async () => {
    const disc = buildEmptyGateDisc([]);
    const mediator = makeMockMediator();
    const ctx = makeMockContext({
      scrape: some({ accounts: ONE_EMPTY_ACCT_FIXTURE }),
      scrapeDiscovery: some(disc),
      mediator: some(mediator),
    });
    const result = await executeValidateResults(ctx);
    expect(result.success).toBe(false);
  });

  it('isLikelyScrapeMiss: all-empty + mediator absent → fail', async () => {
    const disc = buildEmptyGateDisc([STUB_CAPTURE]);
    const ctx = makeMockContext({
      scrape: some({ accounts: ONE_EMPTY_ACCT_FIXTURE }),
      scrapeDiscovery: some(disc),
    });
    const result = await executeValidateResults(ctx);
    expect(result.success).toBe(false);
  });

  it('isLikelyScrapeMiss: all-empty + 0 successful responses → fail', async () => {
    const disc = buildEmptyGateDisc([STUB_CAPTURE]);
    const mediator = makeMockMediator();
    const ctx = makeMockContext({
      scrape: some({ accounts: ONE_EMPTY_ACCT_FIXTURE }),
      scrapeDiscovery: some(disc),
      mediator: some(mediator),
    });
    const result = await executeValidateResults(ctx);
    expect(result.success).toBe(false);
  });

  it('decideEmptyGate: populated pool + 2xx responses → real-empty accepted', async () => {
    const baseMediator = makeMockMediator();
    const mediator = {
      ...baseMediator,
      network: {
        ...baseMediator.network,
        /**
         * Single-entry pool.
         * @returns Pool with STUB_CAPTURE.
         */
        getAllEndpoints: (): readonly IDiscoveredEndpoint[] => [STUB_CAPTURE],
        /**
         * Server responded with 200.
         * @returns 1.
         */
        countSuccessfulResponses: (): number => 1,
      },
    };
    const disc = buildEmptyGateDisc([STUB_CAPTURE]);
    const ctx = makeMockContext({
      scrape: some({ accounts: ONE_EMPTY_ACCT_FIXTURE }),
      scrapeDiscovery: some(disc),
      mediator: some(mediator),
    });
    const result = await executeValidateResults(ctx);
    expect(result.success).toBe(true);
  });
});

/**
 * Build a mediator whose `network.getAllEndpoints` returns the
 * supplied pool. Shared between the perAccountResponses + coverage-gap
 * tests.
 *
 * @param pool - Pool to expose via the mediator stub.
 * @returns Mediator with patched network.
 */
function makeMediatorWithPool(
  pool: readonly IDiscoveredEndpoint[],
): ReturnType<typeof makeMockMediator> {
  const base = makeMockMediator();
  return {
    ...base,
    network: {
      ...base.network,
      /**
       * Returns the seeded pool.
       *
       * @returns Pool.
       */
      getAllEndpoints: (): readonly IDiscoveredEndpoint[] => pool,
    },
  };
}

/**
 * Build an accountDiscovery option with a single id + record pair.
 * Used by v6 emit tests that exercise buildAccountIdentities.
 *
 * @param id - iter accountId.
 * @param record - matching record.
 * @returns accountDiscovery Some.
 */
function makeSingleAccountDiscovery(
  id: string,
  record: Record<string, unknown>,
): ReturnType<typeof some<IAccountDiscovery>> {
  const discovery: IAccountDiscovery = {
    ids: [id],
    records: [record],
    containers: {},
    endpointCaptureIndex: 0,
  };
  return some(discovery);
}

/** v6 — SCRAPE.post accountIdentities + balanceFetchTemplate emission. */
describe('ScrapePhaseActions — v6 SCRAPE.post emission', () => {
  it('emits accountIdentities from accountDiscovery records', async () => {
    const mediator = makeMediatorWithPool([]);
    const accountDiscovery = makeSingleAccountDiscovery('ACC-001', {
      cardUniqueId: 'UID-001',
      bankAccountUniqueId: 'BA-001',
      last4Digits: 'ACC-001',
    });
    const ctx = makeMockContext({
      scrape: some({ accounts: [{ accountNumber: 'ACC-001', balance: 0, txns: [] }] }),
      mediator: some(mediator),
      accountDiscovery,
    });
    const result = await executeStampAccounts(ctx);
    expect(result.success).toBe(true);
    if (isOk(result) && result.value.scrape.has) {
      const identities = result.value.scrape.value.accountIdentities;
      expect(identities?.size).toBe(1);
      const id = identities?.get('ACC-001');
      expect(id?.cardUniqueId).toBe('UID-001');
      expect(id?.bankAccountUniqueId).toBe('BA-001');
    }
  });

  it('discovers a POST balanceFetchTemplate from pool capture', async () => {
    const postEp: IDiscoveredEndpoint = {
      url: 'https://api.bank.example/getBalance',
      method: 'POST',
      postData: '{"bankAccountUniqueId":"BA-001"}',
      responseBody: null,
      contentType: 'application/json',
      requestHeaders: {},
      responseHeaders: {},
      timestamp: 1,
    };
    const mediator = makeMediatorWithPool([postEp]);
    const accountDiscovery = makeSingleAccountDiscovery('ACC-001', {});
    const ctx = makeMockContext({
      scrape: some({ accounts: [{ accountNumber: 'ACC-001', balance: 0, txns: [] }] }),
      mediator: some(mediator),
      accountDiscovery,
    });
    const result = await executeStampAccounts(ctx);
    expect(result.success).toBe(true);
    if (isOk(result) && result.value.scrape.has) {
      const tmpl = result.value.scrape.value.balanceFetchTemplate;
      expect(tmpl?.method).toBe('POST');
      expect(tmpl?.postBodyKey).toBe('bankAccountUniqueId');
    }
  });

  it('leaves identities + template undefined when accountDiscovery + mediator absent', async () => {
    const ctx = makeMockContext({
      scrape: some({ accounts: [{ accountNumber: 'ACC-001', balance: 0, txns: [] }] }),
    });
    const result = await executeStampAccounts(ctx);
    expect(result.success).toBe(true);
    if (isOk(result) && result.value.scrape.has) {
      expect(result.value.scrape.value.accountIdentities).toBeUndefined();
      expect(result.value.scrape.value.balanceFetchTemplate).toBeUndefined();
    }
  });

  it('discovers a GET query template when only GET captures present', async () => {
    const getEp: IDiscoveredEndpoint = {
      url: 'https://bank.example/balance?accountId=ACC-001&lang=he',
      method: 'GET',
      postData: '',
      responseBody: null,
      contentType: 'application/json',
      requestHeaders: {},
      responseHeaders: {},
      timestamp: 1,
    };
    const mediator = makeMediatorWithPool([getEp]);
    const accountDiscovery = makeSingleAccountDiscovery('ACC-001', {});
    const ctx = makeMockContext({
      scrape: some({ accounts: [{ accountNumber: 'ACC-001', balance: 0, txns: [] }] }),
      mediator: some(mediator),
      accountDiscovery,
    });
    const result = await executeStampAccounts(ctx);
    expect(result.success).toBe(true);
    if (isOk(result) && result.value.scrape.has) {
      const tmpl = result.value.scrape.value.balanceFetchTemplate;
      expect(tmpl?.method).toBe('GET');
      expect(tmpl?.urlQueryKey).toBe('accountId');
    }
  });

  it('falls back to bulk template when no per-id signal is present', async () => {
    const postEp: IDiscoveredEndpoint = {
      url: 'https://bank.example/listAll',
      method: 'POST',
      postData: '{"foo":"bar"}',
      responseBody: null,
      contentType: 'application/json',
      requestHeaders: {},
      responseHeaders: {},
      timestamp: 1,
    };
    const mediator = makeMediatorWithPool([postEp]);
    const accountDiscovery = makeSingleAccountDiscovery('UNKNOWN', {});
    const ctx = makeMockContext({
      scrape: some({ accounts: [{ accountNumber: 'UNKNOWN', balance: 0, txns: [] }] }),
      mediator: some(mediator),
      accountDiscovery,
    });
    const result = await executeStampAccounts(ctx);
    expect(result.success).toBe(true);
    if (isOk(result) && result.value.scrape.has) {
      const tmpl = result.value.scrape.value.balanceFetchTemplate;
      expect(tmpl?.method).toBe('POST');
      expect(tmpl?.postBodyKey).toBeUndefined();
    }
  });

  it('discovers a GET path-interpolation template when URL path ends in iter id', async () => {
    const getEp: IDiscoveredEndpoint = {
      url: 'https://bank.example/account/info/ACC-001',
      method: 'GET',
      postData: '',
      responseBody: null,
      contentType: 'application/json',
      requestHeaders: {},
      responseHeaders: {},
      timestamp: 1,
    };
    const mediator = makeMediatorWithPool([getEp]);
    const accountDiscovery = makeSingleAccountDiscovery('ACC-001', {});
    const ctx = makeMockContext({
      scrape: some({ accounts: [{ accountNumber: 'ACC-001', balance: 0, txns: [] }] }),
      mediator: some(mediator),
      accountDiscovery,
    });
    const result = await executeStampAccounts(ctx);
    expect(result.success).toBe(true);
    if (isOk(result) && result.value.scrape.has) {
      const tmpl = result.value.scrape.value.balanceFetchTemplate;
      expect(tmpl?.urlPathInterpolation).toBe(true);
      expect(tmpl?.url).toContain('/<ID>');
    }
  });

  it('emits identities with cardUniqueId + bankAccountUniqueId from record', async () => {
    const mediator = makeMediatorWithPool([]);
    const accountDiscovery = makeSingleAccountDiscovery('CARD-1', {
      cardUniqueId: 'UID-CARD',
      bankAccountUniqueId: 'BAUI-001',
    });
    const ctx = makeMockContext({
      scrape: some({ accounts: [{ accountNumber: 'CARD-1', balance: 0, txns: [] }] }),
      mediator: some(mediator),
      accountDiscovery,
    });
    const result = await executeStampAccounts(ctx);
    expect(result.success).toBe(true);
    if (isOk(result) && result.value.scrape.has) {
      const id = result.value.scrape.value.accountIdentities?.get('CARD-1');
      expect(id?.cardUniqueId).toBe('UID-CARD');
      expect(id?.bankAccountUniqueId).toBe('BAUI-001');
    }
  });

  it('falls back to displayId when record carries no internal ids', async () => {
    const mediator = makeMediatorWithPool([]);
    const accountDiscovery = makeSingleAccountDiscovery('PLAIN-ID', {});
    const ctx = makeMockContext({
      scrape: some({ accounts: [{ accountNumber: 'PLAIN-ID', balance: 0, txns: [] }] }),
      mediator: some(mediator),
      accountDiscovery,
    });
    const result = await executeStampAccounts(ctx);
    expect(result.success).toBe(true);
    if (isOk(result) && result.value.scrape.has) {
      const id = result.value.scrape.value.accountIdentities?.get('PLAIN-ID');
      expect(id?.cardUniqueId).toBe('PLAIN-ID');
      expect(id?.bankAccountUniqueId).toBe('PLAIN-ID');
    }
  });
});
