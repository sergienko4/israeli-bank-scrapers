/**
 * Issue 2 — empty-gate heuristic edge-case unit tests.
 *
 * <p>Targets the residual branches in {@link checkScrapeMissHeuristic}
 * + {@link decideEmptyGate} + {@link emitRealEmptyAccepted} that the
 * cross-bank Wave 5 suite (`ScrapePhaseActionsWave5.test.ts`) does not
 * already exercise:
 *
 * <ul>
 *   <li>nullish-coalescing fallback when
 *       `scrapeDiscovery.frozenEndpoints` is `undefined`
 *       (line 451 branch 1) — Wave 5 covers the empty-array path but
 *       not the absent-field path.</li>
 *   <li>structured info-log payload assertion on the real-empty
 *       accepted path — Wave 5 only checks the success flag.</li>
 *   <li>terminal error message text on the all-empty + scrape miss
 *       branch — Wave 5 only checks the success flag.</li>
 *   <li>multi-account `.some` short-circuit when the
 *       non-empty account is not at index 0.</li>
 *   <li>absent scrape state continues into the success path.</li>
 * </ul>
 *
 * <p>Per `test-guidlines.md` "integration test over unit test;
 * unit test for edge cases only". The empty-gate heuristic IS an
 * edge-case-driven unit (absent-state branches that cross-bank
 * fixtures cannot reach), so unit tests are appropriate here.
 *
 * <p>Test data uses synthetic fixtures only — no captures, no PII,
 * no realistic account numbers per
 * `feedback_no_pii_in_examples.md`.
 */

import { jest } from '@jest/globals';

import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscoveryTypes.js';
import { executeValidateResults } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapePhaseActions.js';
import { none, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IPipelineContext,
  IScrapeDiscovery,
  IScrapeState,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import type { ITransaction, ITransactionsAccount } from '../../../../../Transactions.js';
import {
  makeMockContext,
  makeMockMediator,
} from '../../../Scrapers/Pipeline/MockPipelineFactories.js';

/** Synthetic endpoint capture used by the empty-gate fixtures. */
const SYNTHETIC_ENDPOINT: IDiscoveredEndpoint = {
  url: 'https://bank.example/api/x',
  method: 'GET',
  postData: '',
  responseBody: {},
  contentType: 'application/json',
  requestHeaders: {},
  responseHeaders: {},
  timestamp: 1,
};

/** Account fixture with zero transactions. */
const EMPTY_ACCOUNT_FIXTURE: ITransactionsAccount = {
  accountNumber: 'FAKE-A1',
  balance: 0,
  txns: [],
};

/** Account fixture carrying one transaction (non-empty branch). */
const POPULATED_ACCOUNT_FIXTURE: ITransactionsAccount = {
  accountNumber: 'FAKE-A2',
  balance: 50,
  txns: [
    {
      chargedAmount: -25,
      originalAmount: -25,
      date: '2026-05-15',
      description: 'X',
    } as ITransaction,
  ],
};

/** Sentinel meaning "omit `frozenEndpoints` entirely from the discovery". */
const OMIT_FROZEN: unique symbol = Symbol('omit-frozen');

/**
 * Build a minimal {@link IScrapeDiscovery}.
 *
 * <p>Pass {@link OMIT_FROZEN} to omit the `frozenEndpoints` field
 * entirely so the nullish-coalescing branch in
 * `checkScrapeMissHeuristic` (line 451) becomes reachable.
 *
 * @param frozenEndpoints - Pool entries or {@link OMIT_FROZEN}.
 * @returns Test-only IScrapeDiscovery instance.
 */
function buildDiscovery(
  frozenEndpoints: readonly IDiscoveredEndpoint[] | typeof OMIT_FROZEN,
): IScrapeDiscovery {
  const base: IScrapeDiscovery = {
    qualifiedCards: [],
    prunedCards: [],
    txnTemplateUrl: '',
    txnTemplateBody: {},
    billingMonths: [],
  };
  return frozenEndpoints === OMIT_FROZEN ? base : { ...base, frozenEndpoints };
}

/** Network override bundle accepted by {@link makeMediatorWithPool}. */
interface IPoolOverrides {
  readonly pool: readonly IDiscoveredEndpoint[];
  readonly successCount: number;
}

/**
 * Build a mediator whose `network` returns the supplied pool and
 * 2xx-response count. Keeps every other network method from
 * {@link makeMockMediator} intact.
 *
 * @param overrides - Pool + success counter overrides.
 * @returns Mediator with patched network surface.
 */
function makeMediatorWithPool(overrides: IPoolOverrides): ReturnType<typeof makeMockMediator> {
  const base = makeMockMediator();
  return {
    ...base,
    network: {
      ...base.network,
      /**
       * Returns the seeded pool entries.
       *
       * @returns Pool.
       */
      getAllEndpoints: (): readonly IDiscoveredEndpoint[] => overrides.pool,
      /**
       * Returns the seeded 2xx count.
       *
       * @returns Successful response count.
       */
      countSuccessfulResponses: (): number => overrides.successCount,
    },
  };
}

/** Result of {@link makeSpyContext}. */
interface ISpyContextBundle {
  readonly ctx: IPipelineContext;
  readonly info: jest.Mock;
}

/**
 * Build a context with the supplied overrides plus a spy logger so
 * tests can assert structured emission of `logger.info`.
 *
 * @param overrides - Context overrides applied last.
 * @returns Context + logger spy bundle.
 */
function makeSpyContext(overrides: Partial<IPipelineContext> = {}): ISpyContextBundle {
  const base = makeMockContext(overrides);
  const info = jest.fn();
  const ctx = { ...base, logger: { ...base.logger, info } };
  return { ctx, info };
}

/** Scrape state with one all-empty account. */
const ONE_EMPTY_SCRAPE: IScrapeState = { accounts: [EMPTY_ACCOUNT_FIXTURE] };

/** Scrape state with two accounts where only the second has txns. */
const SECOND_ACCT_POPULATED: IScrapeState = {
  accounts: [EMPTY_ACCOUNT_FIXTURE, POPULATED_ACCOUNT_FIXTURE],
};

/** Pre-built event matcher for the real-empty info-log assertion. */
const ACCEPTED_EVENT_MATCHER = { event: 'scrape.empty-result-accepted' };

/**
 * Build the `expect.objectContaining(...)` matcher for the real-empty
 * accepted info-log event. Extracted because the project's lint config
 * forbids nested call expressions in argument position.
 *
 * @returns Matcher passed to `toHaveBeenCalledWith`.
 */
function acceptedEventMatcher(): object {
  return expect.objectContaining(ACCEPTED_EVENT_MATCHER) as object;
}

describe('Issue 2 — SCRAPE empty-gate heuristic edge cases', () => {
  it('EGH-001 — non-empty account at index >0 short-circuits is-all-empty → success', async () => {
    const bundle = makeSpyContext({ scrape: some(SECOND_ACCT_POPULATED) });
    const result = await executeValidateResults(bundle.ctx);
    const isResultOk = isOk(result);
    expect(isResultOk).toBe(true);
    const matcher = acceptedEventMatcher();
    expect(bundle.info).not.toHaveBeenCalledWith(matcher);
  });

  it('EGH-002b — all-empty + scrapeDiscovery absent → fail with exact miss message', async () => {
    const ctx = makeMockContext({ scrape: some(ONE_EMPTY_SCRAPE), scrapeDiscovery: none() });
    const result = await executeValidateResults(ctx);
    const isResultOk = isOk(result);
    expect(isResultOk).toBe(false);
    if (!isResultOk) {
      const expectedMsg =
        'scrape.post: all 1 accounts have 0 txns AND scrape miss heuristic flagged — fail';
      expect(result.errorMessage).toBe(expectedMsg);
    }
  });

  it('EGH-006a — all-empty + frozenEndpoints undefined → ?? fallback flags miss → fail', async () => {
    const discovery = buildDiscovery(OMIT_FROZEN);
    const mediator = makeMediatorWithPool({ pool: [], successCount: 1 });
    const ctx = makeMockContext({
      scrape: some(ONE_EMPTY_SCRAPE),
      scrapeDiscovery: some(discovery),
      mediator: some(mediator),
    });
    const result = await executeValidateResults(ctx);
    const isResultOk = isOk(result);
    expect(isResultOk).toBe(false);
  });

  it('EGH-006b — populated pool + 2xx → real-empty accepted emits structured info log', async () => {
    const discovery = buildDiscovery([SYNTHETIC_ENDPOINT]);
    const mediator = makeMediatorWithPool({ pool: [SYNTHETIC_ENDPOINT], successCount: 3 });
    const bundle = makeSpyContext({
      scrape: some(ONE_EMPTY_SCRAPE),
      scrapeDiscovery: some(discovery),
      mediator: some(mediator),
    });
    const result = await executeValidateResults(bundle.ctx);
    const isResultOk = isOk(result);
    expect(isResultOk).toBe(true);
    const expectedPayload = {
      event: 'scrape.empty-result-accepted',
      accountCount: '1',
      poolSize: '1',
      successCount: '3',
    };
    const matcher = expect.objectContaining(expectedPayload) as object;
    expect(bundle.info).toHaveBeenCalledWith(matcher);
  });

  it('EGH-008 — scrape state absent → success and no info log fires', async () => {
    const bundle = makeSpyContext();
    const result = await executeValidateResults(bundle.ctx);
    const isResultOk = isOk(result);
    expect(isResultOk).toBe(true);
    const matcher = acceptedEventMatcher();
    expect(bundle.info).not.toHaveBeenCalledWith(matcher);
  });
});
