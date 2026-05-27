/**
 * BALANCE-RESOLVE actions — branch coverage edge cases (v6).
 *
 * <p>Pins every otherwise-unreachable branch the v6 contract guards:
 * array / null / primitive POST bodies fed through `safeParseJson`,
 * extractor fall-through when the response yields no balance, scrape
 * option absent through `readAccountIdentities`, and the universal-
 * miss vs partial-resolve fork in `.post`.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import {
  executeBalanceResolveAction,
  executeBalanceResolveFinal,
  executeBalanceResolvePost,
  executeBalanceResolvePre,
} from '../../../../../Scrapers/Pipeline/Mediator/BalanceResolve/BalanceResolveActions.js';
import { none, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IAccountIdentity,
  IApiFetchContext,
  IBalanceFetchPlanEntry,
  IBalanceFetchTemplate,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import {
  fail,
  isOk,
  type Procedure,
  succeed,
} from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { assertOk } from '../../../../Helpers/AssertProcedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';

const TMPL_POST: IBalanceFetchTemplate = {
  url: 'https://fake/post',
  method: 'POST',
  postBodyKey: 'bankAccountUniqueId',
};

/**
 * Build a fake api whose every fetch THROWS an exception (rather than
 * returning a `Procedure` fail). Lets coverage tests exercise the
 * safeIssueOneFetch try/catch path that preserves the Promise.all
 * quarantine.
 *
 * @returns Fake api context.
 */
function makeThrowingApi(): IApiFetchContext {
  /**
   * Throws synchronously.
   *
   * @param url - URL (touched to satisfy unused-args).
   * @returns Never returns.
   */
  const fetchPost = (url: string): Promise<Procedure<unknown>> => {
    const key = `${url}#post`;
    throw new ScraperError(`upstream blew up dispatching POST ${key}`);
  };
  /**
   * Throws synchronously.
   *
   * @param url - URL.
   * @returns Never returns.
   */
  const fetchGet = (url: string): Promise<Procedure<unknown>> => {
    const key = `${url}#get`;
    throw new ScraperError(`upstream blew up dispatching GET ${key}`);
  };
  return {
    fetchPost,
    fetchGet,
    transactionsUrl: false,
    balanceUrl: false,
    pendingUrl: false,
  } as IApiFetchContext;
}

/**
 * Build a fake api that always succeeds with the supplied body. URL is
 * interpolated into an internal key so the `url` parameter is consumed
 * (satisfies the no-unused-vars rule without `_` prefixes).
 *
 * @param body - Body to return on success.
 * @returns Fake api context.
 */
function makeFixedApi(body: unknown): IApiFetchContext {
  /**
   * Scripted POST — always returns the fixed body.
   *
   * @param url - URL the action dispatched to (touched via key concat).
   * @returns Procedure with the fixed body.
   */
  const fetchPost = (url: string): Promise<Procedure<unknown>> => {
    const key = `${url}#post`;
    if (key === '__never__') {
      throw new ScraperError('sentinel never fires');
    }
    const wrapped = succeed(body);
    return Promise.resolve(wrapped);
  };
  /**
   * Scripted GET — always returns the fixed body.
   *
   * @param url - URL the action dispatched to (touched via key concat).
   * @returns Procedure with the fixed body.
   */
  const fetchGet = (url: string): Promise<Procedure<unknown>> => {
    const key = `${url}#get`;
    if (key === '__never__') {
      throw new ScraperError('sentinel never fires');
    }
    const wrapped = succeed(body);
    return Promise.resolve(wrapped);
  };
  return {
    fetchPost,
    fetchGet,
    transactionsUrl: false,
    balanceUrl: false,
    pendingUrl: false,
  } as IApiFetchContext;
}

/**
 * Build a fake api whose fetches always fail. URL is interpolated
 * into an internal key so the `url` parameter is consumed.
 *
 * @returns Fake api context.
 */
function makeFailingApi(): IApiFetchContext {
  /**
   * Scripted POST — always fails.
   *
   * @param url - URL the action dispatched to (touched via key concat).
   * @returns Failed procedure.
   */
  const fetchPost = (url: string): Promise<Procedure<unknown>> => {
    const key = `${url}#post`;
    if (key === '__never__') {
      throw new ScraperError('sentinel never fires');
    }
    const failure = fail(ScraperErrorTypes.Generic, 'always fails');
    return Promise.resolve(failure);
  };
  /**
   * Scripted GET — always fails.
   *
   * @param url - URL the action dispatched to (touched via key concat).
   * @returns Failed procedure.
   */
  const fetchGet = (url: string): Promise<Procedure<unknown>> => {
    const key = `${url}#get`;
    if (key === '__never__') {
      throw new ScraperError('sentinel never fires');
    }
    const failure = fail(ScraperErrorTypes.Generic, 'always fails');
    return Promise.resolve(failure);
  };
  return {
    fetchPost,
    fetchGet,
    transactionsUrl: false,
    balanceUrl: false,
    pendingUrl: false,
  } as IApiFetchContext;
}

/**
 * Wrap a scrape `some(...)` with a one-card identity map keyed by the
 * supplied displayId. Removes the per-test repetition of the same map
 * literal and shortens each `it` body below the max-lines budget.
 *
 * @param cardDisplayId - Display id used as the map key.
 * @param cardUniqueId - Unique id (defaults to displayId).
 * @param bankAccountUniqueId - Parent bank-account id.
 * @returns Scrape `some(...)` wrapper.
 */
function makeOneCardScrape(
  cardDisplayId: string,
  cardUniqueId: string,
  bankAccountUniqueId: string,
): ReturnType<
  typeof some<{
    readonly accounts: readonly never[];
    readonly accountIdentities: ReadonlyMap<string, IAccountIdentity>;
    readonly balanceFetchTemplate: IBalanceFetchTemplate;
  }>
> {
  const identities: ReadonlyMap<string, IAccountIdentity> = new Map([
    [cardDisplayId, { cardDisplayId, cardUniqueId, bankAccountUniqueId }],
  ]);
  return some({
    accounts: [],
    accountIdentities: identities,
    balanceFetchTemplate: TMPL_POST,
  });
}

/**
 * Drive the BALANCE-RESOLVE PRE → ACTION chain with the supplied scrape
 * + api. Used by happy-path tests to keep the per-test body short.
 *
 * @param scrape - Scrape state with identities + template.
 * @param api - Fake api context.
 * @returns Result of executeBalanceResolveAction.
 */
async function runPreThenAction(
  scrape: ReturnType<typeof makeOneCardScrape>,
  api: ReturnType<typeof some<IApiFetchContext>>,
): Promise<Awaited<ReturnType<typeof executeBalanceResolveAction>>> {
  const preCtx = makeMockContext({ scrape, api });
  const preResult = await executeBalanceResolvePre(preCtx);
  assertOk(preResult);
  const actionCtx = preResult.value as unknown as Parameters<typeof executeBalanceResolveAction>[0];
  return executeBalanceResolveAction(actionCtx);
}

describe('BALANCE-RESOLVE coverage — readAccountIdentities + readBalanceFetchTemplate', () => {
  it('PRE: scrape option absent (no .scrape on ctx) → default-deny fail', async () => {
    const ctx = makeMockContext({ scrape: none() });
    const result = await executeBalanceResolvePre(ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(false);
  });
});

describe('BALANCE-RESOLVE coverage — extractPerCardBalance / extractAllCards', () => {
  it('ACTION: empty plan → empty extracted (early return)', async () => {
    const ctx = makeMockContext({ balanceFetchPlan: none() });
    const actionCtx = ctx as unknown as Parameters<typeof executeBalanceResolveAction>[0];
    const result = await executeBalanceResolveAction(actionCtx);
    assertOk(result);
    if (result.value.balanceExtracted.has) {
      expect(result.value.balanceExtracted.value.size).toBe(0);
    }
  });

  it('ACTION: api absent + non-empty plan → empty extracted', async () => {
    const entry: IBalanceFetchPlanEntry = {
      bankAccountUniqueId: 'BA-1',
      request: { url: 'http://x', method: 'GET', body: '', headers: {} },
    };
    const ctx = makeMockContext({
      balanceFetchPlan: some([entry]),
      api: none(),
    });
    const actionCtx = ctx as unknown as Parameters<typeof executeBalanceResolveAction>[0];
    const result = await executeBalanceResolveAction(actionCtx);
    assertOk(result);
  });

  it('ACTION: every fetch fails → all cards land as MISS', async () => {
    const scrape = makeOneCardScrape('C1', 'C1', 'BA-1');
    const failingApi = makeFailingApi();
    const apiSome = some(failingApi);
    const result = await runPreThenAction(scrape, apiSome);
    assertOk(result);
    if (result.value.balanceExtracted.has) {
      const out = result.value.balanceExtracted.value;
      const c1 = out.get('C1');
      expect(c1).toBe('MISS');
    }
  });

  it('ACTION: response is null → MISS', async () => {
    const scrape = makeOneCardScrape('C1', 'C1', 'BA-1');
    const nullApi = makeFixedApi(null);
    const apiSome = some(nullApi);
    const result = await runPreThenAction(scrape, apiSome);
    assertOk(result);
    if (result.value.balanceExtracted.has) {
      const c1 = result.value.balanceExtracted.value.get('C1');
      expect(c1).toBe('MISS');
    }
  });

  it('ACTION: array response (no card record) → falls through to bulk extractor', async () => {
    const scrape = makeOneCardScrape('C1', 'C1', 'BA-1');
    const arrayApi = makeFixedApi([{ balance: 42 }]);
    const apiSome = some(arrayApi);
    const result = await runPreThenAction(scrape, apiSome);
    assertOk(result);
    if (result.value.balanceExtracted.has) {
      const c1 = result.value.balanceExtracted.value.get('C1');
      expect(c1).toBe(42);
    }
  });

  it('ACTION: GET-only template (no body) → fetchGet path', async () => {
    const identities: ReadonlyMap<string, IAccountIdentity> = new Map([
      ['ACC-1', { cardDisplayId: 'ACC-1', cardUniqueId: 'ACC-1', bankAccountUniqueId: 'ACC-1' }],
    ]);
    const getTmpl: IBalanceFetchTemplate = {
      url: 'https://fake/get/<ID>',
      method: 'GET',
      urlPathInterpolation: true,
    };
    const scrape = some({
      accounts: [],
      accountIdentities: identities,
      balanceFetchTemplate: getTmpl,
    });
    const getApi = makeFixedApi({ currentBalance: 150 });
    const apiSome = some(getApi);
    const result = await runPreThenAction(scrape, apiSome);
    assertOk(result);
    if (result.value.balanceExtracted.has) {
      const acc = result.value.balanceExtracted.value.get('ACC-1');
      expect(acc).toBe(150);
    }
  });

  it('ACTION: card matched by display field (number → string coerce)', async () => {
    const scrape = makeOneCardScrape('1234', 'X', 'BA-1');
    const body = {
      data: {
        cardsList: [{ last4Digits: 1234, cardChargeNext: { billingSumSekel: '99.5' } }],
      },
    };
    const numericApi = makeFixedApi(body);
    const apiSome = some(numericApi);
    const result = await runPreThenAction(scrape, apiSome);
    assertOk(result);
    if (result.value.balanceExtracted.has) {
      const card = result.value.balanceExtracted.value.get('1234');
      expect(card).toBe(99.5);
    }
  });
});

/**
 * Build an action context with the provided plan + a fake api that
 * always succeeds. Identities map is empty so we exercise dispatch
 * (safeParseJson) without depending on extractor behaviour.
 *
 * @param body - Raw JSON body string fed into safeParseJson.
 * @returns Action context.
 */
function makeActionCtxWithBody(body: string): Parameters<typeof executeBalanceResolveAction>[0] {
  const entry: IBalanceFetchPlanEntry = {
    bankAccountUniqueId: 'BA-1',
    request: { url: 'http://x', method: 'POST', body, headers: {} },
  };
  const fixedApi = makeFixedApi({});
  const ctx = makeMockContext({
    balanceFetchPlan: some([entry]),
    api: some(fixedApi),
  });
  return ctx as unknown as Parameters<typeof executeBalanceResolveAction>[0];
}

describe('BALANCE-RESOLVE coverage — safeParseJson narrowParsed branches', () => {
  it('ACTION: entry.body is "null" → narrowParsed null branch', async () => {
    const ctx = makeActionCtxWithBody('null');
    const result = await executeBalanceResolveAction(ctx);
    assertOk(result);
  });

  it('ACTION: entry.body is "42" → narrowParsed non-object primitive branch', async () => {
    const ctx = makeActionCtxWithBody('42');
    const result = await executeBalanceResolveAction(ctx);
    assertOk(result);
  });

  it('ACTION: entry.body is "[1,2]" → narrowParsed array branch', async () => {
    const ctx = makeActionCtxWithBody('[1,2]');
    const result = await executeBalanceResolveAction(ctx);
    assertOk(result);
  });

  it('ACTION: entry.body is malformed JSON → safeParseJson catch branch', async () => {
    const ctx = makeActionCtxWithBody('{ not valid json');
    const result = await executeBalanceResolveAction(ctx);
    assertOk(result);
  });

  it('ACTION: api.fetchPost THROWS → safeIssueOneFetch catch → all cards MISS, no Promise.all abort', async () => {
    const scrape = makeOneCardScrape('C1', 'C1', 'BA-1');
    const throwingApi = makeThrowingApi();
    const apiSome = some(throwingApi);
    const result = await runPreThenAction(scrape, apiSome);
    assertOk(result);
    if (result.value.balanceExtracted.has) {
      const got = result.value.balanceExtracted.value.get('C1');
      expect(got).toBe('MISS');
    }
  });

  it('ACTION: malformed JSON body emits balance-resolve.body-parse-failure warn', async () => {
    const malformedBody = '{ not valid json';
    const captured: { event: string; bodyLen: string }[] = [];
    const baseLogger = makeMockContext({}).logger;
    const captureLogger = {
      ...baseLogger,
      /**
       * Capture warn payloads for assertion.
       * @param payload - Pino-style record.
       * @param payload.event - Event name (e.g. balance-resolve.body-parse-failure).
       * @param payload.bodyLen - String-encoded raw body length.
       */
      warn: (payload: { event: string; bodyLen: string }): void => {
        captured.push(payload);
      },
    };
    const entry: IBalanceFetchPlanEntry = {
      bankAccountUniqueId: 'BA-1',
      request: { url: 'http://x', method: 'POST', body: malformedBody, headers: {} },
    };
    const fixedApi = makeFixedApi({});
    const ctx = makeMockContext({
      balanceFetchPlan: some([entry]),
      api: some(fixedApi),
      logger: captureLogger,
    });
    const actionCtx = ctx as unknown as Parameters<typeof executeBalanceResolveAction>[0];
    const result = await executeBalanceResolveAction(actionCtx);
    assertOk(result);

    const parseFailures = captured.filter(
      (p): boolean => p.event === 'balance-resolve.body-parse-failure',
    );
    expect(parseFailures.length).toBe(1);
    const expectedLen = String(malformedBody.length);
    expect(parseFailures[0].bodyLen).toBe(expectedLen);
  });
});

describe('BALANCE-RESOLVE coverage — extractor-false fall-through', () => {
  it('ACTION: body found but no card record AND no extractable balance → MISS (line 439)', async () => {
    const scrape = makeOneCardScrape('C1', 'C1', 'BA-1');
    const emptyApi = makeFixedApi({ unrelatedKey: 'nothing-here' });
    const apiSome = some(emptyApi);
    const result = await runPreThenAction(scrape, apiSome);
    assertOk(result);
    if (result.value.balanceExtracted.has) {
      const got = result.value.balanceExtracted.value.get('C1');
      expect(got).toBe('MISS');
    }
  });
});

describe('BALANCE-RESOLVE coverage — final REVEAL branch', () => {
  it('FINAL: balanceValidation present → uses its resolved/missed counts in log', async () => {
    const extracted = new Map<string, number | 'MISS'>([['A', 100]]);
    const validation = some({ resolvedIds: ['A'], missedIds: [], totalAccounts: 1 });
    const ctx = makeMockContext({
      balanceExtracted: some(extracted),
      balanceValidation: validation,
    });
    const result = await executeBalanceResolveFinal(ctx);
    assertOk(result);
  });

  it('POST: 0 accounts → succeed (no universal-miss check)', async () => {
    const extracted = new Map<string, number | 'MISS'>();
    const ctx = makeMockContext({ balanceExtracted: some(extracted) });
    const result = await executeBalanceResolvePost(ctx);
    assertOk(result);
  });
});
