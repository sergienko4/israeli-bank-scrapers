/**
 * Unit and integration tests for ApiDirectScrapeRetry.ts.
 *
 * Unit: isTransientFailure edge-case coverage — proves 429/5xx are
 * transient, 4xx client errors are not, and success is never transient.
 *
 * Integration (RED→GREEN proof): the same scripted fail-then-succeed
 * apiPost sequence produces a successful balance with retry present
 * (GREEN) and a degraded fallback without it (RED), confirming that
 * a transient /sync blip no longer trips payBoxEmptyResultGuard.
 */

import { jest } from '@jest/globals';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import type { IApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import { isTransientFailure } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapeRetry.js';
import type { IAcctCtx } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapeSteps.js';
import { fetchBalance } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapeSteps.js';
import type {
  IApiDirectScrapeShape,
  ITransientRetryPolicy,
} from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { IActionContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';

// ---------------------------------------------------------------------------
// Shared local account type
// ---------------------------------------------------------------------------

/** Local account type used by all retry tests. */
interface IBalanceTestAcct {
  readonly id: string;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** urlTag routing key for the mock bus; must match the shape's balance.urlTag. */
const BALANCE_URL_TAG = 'data.sync' as const;

/** Transient server-error message in the fetch-strategy format. */
const TRANSIENT_503_MSG = 'POST https://box.co 503: Service unavailable';

// ---------------------------------------------------------------------------
// Named stub functions — extracted from inline arrows to satisfy
// jsdoc/require-jsdoc which fires on ArrowFunctionExpression property values.
// ---------------------------------------------------------------------------

/**
 * Extracts the numeric balance field from an API response body.
 * @param body - Raw API response body.
 * @returns Extracted balance value.
 */
function testExtractBalance(body: Record<string, unknown>): number {
  return (body as { balance: number }).balance;
}

/**
 * Returns the test account's string ID.
 * @param a - Test account.
 * @returns The account's id field.
 */
function testAcctNumberOf(a: IBalanceTestAcct): string {
  return a.id;
}

/**
 * Returns an empty vars map stub for any buildVars slot.
 * @returns Empty Record.
 */
function testEmptyVars(): Record<string, unknown> {
  return {};
}

/**
 * Returns an empty account list stub.
 * @returns Empty readonly array.
 */
function testEmptyAccounts(): readonly IBalanceTestAcct[] {
  return [];
}

/**
 * Returns an empty transactions page stub.
 * @returns Page with no items and false cursor.
 */
function testEmptyPage(): { readonly items: readonly object[]; readonly nextCursor: false } {
  return { items: [], nextCursor: false };
}

/**
 * Returns an empty session context stub.
 * @returns Empty readonly record.
 */
function testSessionContext(): Readonly<Record<string, unknown>> {
  return {};
}

// ---------------------------------------------------------------------------
// Shape factory
// ---------------------------------------------------------------------------

/**
 * Builds a minimal ApiDirectScrape shape wired to REST balance dispatch
 * via BALANCE_URL_TAG. Customer and transactions stubs are no-ops.
 * @param retryOnTransient - Opt-in retry policy; absent ⇒ single-shot.
 * @returns Minimal shape for balance-retry tests.
 */
function makeTestShape(
  retryOnTransient?: ITransientRetryPolicy,
): IApiDirectScrapeShape<IBalanceTestAcct, string> {
  return {
    stepName: 'ApiDirectScrapeRetryTest',
    accountNumberOf: testAcctNumberOf,
    customer: {
      buildVars: testEmptyVars,
      extractAccounts: testEmptyAccounts,
    },
    balance: {
      urlTag: BALANCE_URL_TAG,
      buildVars: testEmptyVars,
      extract: testExtractBalance,
      fallbackOnFail: 0,
      retryOnTransient,
    },
    transactions: {
      buildVars: testEmptyVars,
      extractPage: testEmptyPage,
    },
  };
}

// ---------------------------------------------------------------------------
// Bus factory
// ---------------------------------------------------------------------------

/**
 * Builds a scripted mock bus that serves responses from a queue.
 * Each apiPost call shifts one entry; an exhausted queue returns a failure.
 * @param responses - Queue of scripted Procedure responses.
 * @returns Mock bus and the apiPost spy for call-count assertions.
 */
function makeScriptedBus(responses: Procedure<unknown>[]): {
  bus: IApiMediator;
  apiPost: jest.Mock<Promise<Procedure<unknown>>, [string, Record<string, unknown>]>;
} {
  const apiPost = jest.fn(
    async (url: string, body: Record<string, unknown>): Promise<Procedure<unknown>> => {
      await Promise.resolve();
      const keyCount = String(Object.keys(body).length);
      const noStub = `no stub: ${url} (${keyCount} keys)`;
      return responses.shift() ?? fail(ScraperErrorTypes.Generic, noStub);
    },
  );
  const bus = {
    apiPost,
    apiGet: jest.fn(),
    apiQuery: jest.fn(),
    setBearer: jest.fn(),
    setRawAuth: jest.fn(),
    setSessionContext: jest.fn(),
    getSessionContext: jest.fn(testSessionContext),
    withTokenResolver: jest.fn(),
    withTokenStrategy: jest.fn(),
    primeSession: jest.fn(),
  } as unknown as IApiMediator;
  return { bus, apiPost };
}

// ---------------------------------------------------------------------------
// Context factories
// ---------------------------------------------------------------------------

/**
 * Builds a minimal IActionContext via the mock factory.
 * @returns Cast mock action context.
 */
function makeCtx(): IActionContext {
  const base = makeMockContext({});
  return base as unknown as IActionContext;
}

/**
 * Builds a per-account context wrapping the given bus and optional retry policy.
 * @param bus - Mock API mediator.
 * @param retryOnTransient - Opt-in retry policy; absent ⇒ single-shot.
 * @returns Per-account context ready for fetchBalance.
 */
function makeAcctCtx(
  bus: IApiMediator,
  retryOnTransient?: ITransientRetryPolicy,
): IAcctCtx<IBalanceTestAcct, string> {
  return {
    bus,
    ctx: makeCtx(),
    shape: makeTestShape(retryOnTransient),
    acct: { id: 'test-acct' },
  };
}

// ---------------------------------------------------------------------------
// isTransientFailure edge cases
// ---------------------------------------------------------------------------

describe('isTransientFailure', () => {
  it('ARR-EDGE-1 success → false', () => {
    const proc = succeed({ x: 1 });
    const isTransient = isTransientFailure(proc);
    expect(isTransient).toBe(false);
  });

  it('ARR-EDGE-2 HTTP 429 → true', () => {
    const proc = fail(ScraperErrorTypes.Generic, 'POST https://x 429: Rate limited');
    const isTransient = isTransientFailure(proc);
    expect(isTransient).toBe(true);
  });

  it('ARR-EDGE-3 HTTP 500 → true', () => {
    const proc = fail(ScraperErrorTypes.Generic, 'POST https://x 500: Internal error');
    const isTransient = isTransientFailure(proc);
    expect(isTransient).toBe(true);
  });

  it('ARR-EDGE-4 HTTP 503 → true', () => {
    const proc = fail(ScraperErrorTypes.Generic, TRANSIENT_503_MSG);
    const isTransient = isTransientFailure(proc);
    expect(isTransient).toBe(true);
  });

  it('ARR-EDGE-5 HTTP 599 → true', () => {
    const proc = fail(ScraperErrorTypes.Generic, 'POST https://x 599: Unknown gateway');
    const isTransient = isTransientFailure(proc);
    expect(isTransient).toBe(true);
  });

  it('ARR-EDGE-6 HTTP 400 → false (client error, not transient)', () => {
    const proc = fail(ScraperErrorTypes.Generic, 'POST https://x 400: Bad request');
    const isTransient = isTransientFailure(proc);
    expect(isTransient).toBe(false);
  });

  it('ARR-EDGE-7 HTTP 401 → false (auth error, never retry)', () => {
    const proc = fail(ScraperErrorTypes.Generic, 'POST https://x 401: Unauthorized');
    const isTransient = isTransientFailure(proc);
    expect(isTransient).toBe(false);
  });

  it('ARR-EDGE-8 HTTP 403 → false (permission error, never retry)', () => {
    const proc = fail(ScraperErrorTypes.Generic, 'POST https://x 403: Forbidden');
    const isTransient = isTransientFailure(proc);
    expect(isTransient).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// fetchBalance RED→GREEN proof
// ---------------------------------------------------------------------------

describe('fetchBalance transient retry', () => {
  it('ARR-INT-1 with retryOnTransient: 503 then success → success, apiPost called twice', async () => {
    const failResp = fail(ScraperErrorTypes.Generic, TRANSIENT_503_MSG);
    const succResp = succeed({ balance: 99 });
    const { bus, apiPost } = makeScriptedBus([failResp, succResp]);
    const a = makeAcctCtx(bus, { maxRetries: 2, backoffMs: 0 });
    const result = await fetchBalance(a);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toEqual({ value: 99, degraded: false });
    }
    expect(apiPost).toHaveBeenCalledTimes(2);
  });

  it('ARR-INT-2 without retryOnTransient: 503 → degraded fallback, apiPost called once', async () => {
    const failResp = fail(ScraperErrorTypes.Generic, TRANSIENT_503_MSG);
    const succResp = succeed({ balance: 99 });
    const { bus, apiPost } = makeScriptedBus([failResp, succResp]);
    const a = makeAcctCtx(bus);
    const result = await fetchBalance(a);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toEqual({ value: 0, degraded: true });
    }
    expect(apiPost).toHaveBeenCalledTimes(1);
  });
});
