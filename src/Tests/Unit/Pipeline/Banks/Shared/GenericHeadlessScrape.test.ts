/**
 * Unit tests for the shared GenericHeadlessScrape driver.
 * Exercises guard + happy + failure-propagation branches using a
 * synthetic shape (zero bank-name coupling in the test itself).
 */

import { jest } from '@jest/globals';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import type { IApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import { buildGenericHeadlessScrape } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapeActions.js';
import type { IApiDirectScrapeShape } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { IPage } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/Pagination.js';
import type { IScrapeState } from '../../../../../Scrapers/Pipeline/Types/Domain/ScrapeState.js';
import { none, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IActionContext,
  IPipelineContext,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { assertHas, assertOk } from '../../../../Helpers/AssertProcedure.js';
import { makeMockContext, makeRecoverySessionStubs } from '../../Infrastructure/MockFactories.js';

/** Synthetic account ref — minimum the shape needs. */
interface ISynAcct {
  readonly id: string;
  readonly num: string;
}

/**
 * Build a synthetic shape with string cursor (matches OneZero semantics).
 * @returns Synthetic scrape shape.
 */
function makeShape(): IApiDirectScrapeShape<ISynAcct, string> {
  return {
    stepName: 'SynScrape',
    accountNumberOf: accountNumberOfSyn,
    customer: { buildVars: emptyVars, extractAccounts: extractAccountsSyn },
    balance: { buildVars: balVarsSyn, extract: balExtractSyn },
    transactions: {
      buildVars: txnVarsSyn,
      extractPage: extractPageSyn,
      windowNarrowing: 'windowEnd',
    },
  };
}

/**
 * Return the display number for a synthetic account ref.
 * @param a - Account ref.
 * @returns Display number.
 */
function accountNumberOfSyn(a: ISynAcct): string {
  return a.num;
}

/**
 * Empty-vars helper (customer query needs no variables).
 * @returns Empty record.
 */
function emptyVars(): Record<string, unknown> {
  return {};
}

/**
 * Extract synthetic accounts from a router-backed customer response.
 * Unified scrape-shape signature — only `args.body` is used here.
 * @param args - Extract-args bundle.
 * @param args.body - Hydrated response body.
 * @returns Synthetic account list.
 */
function extractAccountsSyn(args: { readonly body: Record<string, unknown> }): readonly ISynAcct[] {
  return (args.body as { accts: readonly ISynAcct[] }).accts;
}

/**
 * Extract synthetic balance value.
 * @param body - Balance response body.
 * @returns Balance value.
 */
function balExtractSyn(body: Record<string, unknown>): number {
  return (body as { balance: number }).balance;
}

/**
 * Balance vars builder for the synthetic shape.
 * @param a - Account ref.
 * @returns Variables map.
 */
function balVarsSyn(a: ISynAcct): Record<string, unknown> {
  return { id: a.id };
}

/**
 * Transactions vars builder for the synthetic shape.
 * @param a - Account ref.
 * @returns Variables map.
 */
function txnVarsSyn(a: ISynAcct): Record<string, unknown> {
  return { id: a.id };
}

/**
 * Extract a synthetic page (body is already shaped as IPage).
 * Unified scrape-shape signature — only `args.body` is used here.
 * @param args - Extract-args bundle.
 * @param args.body - Hydrated response body.
 * @returns Generic page.
 */
function extractPageSyn(args: { readonly body: Record<string, unknown> }): IPage<object, string> {
  return args.body as unknown as IPage<object, string>;
}

/**
 * Build a router-backed mock mediator.
 * @param router - Per-op ordered response queue.
 * @returns Mock mediator.
 */
function makeRouterBus(router: Record<string, readonly Procedure<unknown>[]>): IApiMediator {
  const queues: Record<string, Procedure<unknown>[]> = {};
  for (const key of Object.keys(router)) queues[key] = [...router[key]];
  /**
   * Shift the queue for an operation.
   * @param op - Operation label.
   * @returns Next queued procedure.
   */
  async function route(op: string): Promise<Procedure<unknown>> {
    await Promise.resolve();
    const q = queues[op] ?? [];
    const head = q.shift();
    if (head) return head;
    return fail(ScraperErrorTypes.Generic, `no stub for op=${op}`);
  }
  const apiQuery = jest.fn(route);
  return {
    apiPost: jest.fn(),
    apiGet: jest.fn(),
    apiQuery,
    setBearer: jest.fn(),
    setRawAuth: jest.fn(),
    setSessionContext: jest.fn(),
    ...makeRecoverySessionStubs(),
    getSessionContext: jest.fn((): Readonly<Record<string, unknown>> => ({})),
  } as unknown as IApiMediator;
}

/**
 * Wrap a bus into an IActionContext for the driver.
 *
 * <p>`windowEnd` is set explicitly because it lives on `IActionContext`, not on
 * the `IPipelineContext` the shared factory builds — the cast below would
 * otherwise hand the driver `undefined` where every real context carries an
 * Option, and the backfill planner would fault on the first narrowed round.
 *
 * @param bus - Mock mediator.
 * @returns Action context.
 */
function ctxOf(bus: IApiMediator): IActionContext {
  const base = makeMockContext();
  const withBus: IPipelineContext = {
    ...base,
    apiMediator: some(bus),
  };
  return { ...withBus, windowEnd: none() } as unknown as IActionContext;
}

describe('buildGenericHeadlessScrape', () => {
  it('fails with "ApiMediator missing" when the slot is empty', async () => {
    const shape = makeShape();
    const scrape = buildGenericHeadlessScrape(shape);
    const base = makeMockContext({ apiMediator: none() });
    const result = await scrape(base as unknown as IActionContext);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('ApiMediator missing');
  });

  it('no accounts → empty scrape, no balance/txn calls', async () => {
    const bus = makeRouterBus({ customer: [succeed({ accts: [] })] });
    const shape = makeShape();
    const scrape = buildGenericHeadlessScrape(shape);
    const ctx = ctxOf(bus);
    const result = await scrape(ctx);
    assertOk(result);
    const scr = result.value.scrape;
    assertHas(scr);
    expect(scr.value.accounts).toHaveLength(0);
  });

  it('single account + single-page txns → one ITransactionsAccount', async () => {
    const bus = makeRouterBus({
      customer: [succeed({ accts: [{ id: 'a1', num: 'num-1' }] })],
      balance: [succeed({ balance: 42 })],
      transactions: [succeed({ items: [], nextCursor: false })],
    });
    const shape = makeShape();
    const scrape = buildGenericHeadlessScrape(shape);
    const ctx = ctxOf(bus);
    const result = await scrape(ctx);
    assertOk(result);
    const scr = result.value.scrape;
    assertHas(scr);
    expect(scr.value.accounts).toHaveLength(1);
    expect(scr.value.accounts[0].balance).toBe(42);
    expect(scr.value.accounts[0].accountNumber).toBe('num-1');
  });

  it('customer fail short-circuits', async () => {
    const bus = makeRouterBus({ customer: [fail(ScraperErrorTypes.Generic, 'cust bad')] });
    const shape = makeShape();
    const scrape = buildGenericHeadlessScrape(shape);
    const ctx = ctxOf(bus);
    const result = await scrape(ctx);
    expect(result.success).toBe(false);
  });

  it('extraHeaders + transactions.stop predicate are honoured', async () => {
    const bus = makeRouterBus({
      customer: [succeed({ accts: [{ id: 'a1', num: 'num-1' }] })],
      balance: [succeed({ balance: 10 })],
      transactions: [succeed({ items: [{ k: 1 }], nextCursor: 'c2' })],
    });
    const base = makeShape();
    const shape: IApiDirectScrapeShape<ISynAcct, string> = {
      ...base,
      customer: { ...base.customer, extraHeaders: { queryname: 'QC' } },
      balance: { ...base.balance, extraHeaders: { queryname: 'QB' } },
      transactions: {
        ...base.transactions,
        extraHeaders: { queryname: 'QT' },
        stop: stopAfterOne,
      },
    };
    const scrape = buildGenericHeadlessScrape(shape);
    const ctx = ctxOf(bus);
    const result = await scrape(ctx);
    expect(result.success).toBe(true);
    assertOk(result);
  });

  it('balance fail without fallback propagates; with fallback returns fallback', async () => {
    const bus = makeRouterBus({
      customer: [succeed({ accts: [{ id: 'a1', num: 'num-1' }] })],
      balance: [fail(ScraperErrorTypes.Generic, 'bal bad')],
    });
    const shape = makeShape();
    const scrape = buildGenericHeadlessScrape(shape);
    const ctx = ctxOf(bus);
    const first = await scrape(ctx);
    expect(first.success).toBe(false);

    const bus2 = makeRouterBus({
      customer: [succeed({ accts: [{ id: 'a1', num: 'num-1' }] })],
      balance: [fail(ScraperErrorTypes.Generic, 'bal bad')],
      transactions: [succeed({ items: [], nextCursor: false })],
    });
    const base = makeShape();
    const shape2: IApiDirectScrapeShape<ISynAcct, string> = {
      ...base,
      balance: { ...base.balance, fallbackOnFail: 0 },
    };
    const scrape2 = buildGenericHeadlessScrape(shape2);
    const ctx2 = ctxOf(bus2);
    const result2 = await scrape2(ctx2);
    assertOk(result2);
  });
});

/**
 * Backfill exhaustion, observed where a caller would see it.
 *
 * <p>The flag is only worth carrying if it survives the whole chain — the
 * account walk, the per-account result, and the fold into the scrape slot.
 * Asserting it on a hand-built state instead would pass even with every
 * propagation step deleted, which is exactly the silence the flag exists to
 * break. These drive the real driver and read the committed slot.
 *
 * <p>Exhaustion is provoked through the "bound did not move" refusal rather
 * than the twelve-ask ceiling: both set the same fact, and the short path
 * keeps the stub queue readable.
 */
describe('buildGenericHeadlessScrape reports window completeness', () => {
  /** A row dated long after the mock context's 2024-01-01 start. */
  const lateRow = { date: '2026-07-15' };

  /** A row dated before that start, which proves the window covered. */
  const earlyRow = { date: '2023-12-01' };

  /**
   * Drive the real driver over a bus and read the committed scrape state.
   * @param bus - Mock mediator carrying the scripted responses.
   * @returns Committed scrape state.
   */
  async function stateFrom(bus: IApiMediator): Promise<IScrapeState> {
    const shape = makeShape();
    const scrape = buildGenericHeadlessScrape(shape);
    const ctx = ctxOf(bus);
    const result = await scrape(ctx);
    assertOk(result);
    const scr = result.value.scrape;
    assertHas(scr);
    return scr.value;
  }

  /**
   * Drive one account with a scripted transactions queue.
   * @param pages - Ordered transactions responses.
   * @returns Committed scrape state.
   */
  async function scrapeWith(pages: readonly Procedure<unknown>[]): Promise<IScrapeState> {
    const bus = makeRouterBus({
      customer: [succeed({ accts: [{ id: 'a1', num: 'num-1' }] })],
      balance: [succeed({ balance: 42 })],
      transactions: [...pages],
    });
    return stateFrom(bus);
  }

  it('flags the window as exhausted when backfill asks and still falls short', async () => {
    const stalled = succeed({ items: [lateRow], nextCursor: false });
    const state = await scrapeWith([stalled, stalled]);
    expect(state.backfillExhausted).toBe(true);
  });

  it('leaves the window unflagged when the rows already cover it', async () => {
    const covering = succeed({ items: [earlyRow], nextCursor: false });
    const state = await scrapeWith([covering]);
    expect(state.backfillExhausted).toBe(false);
  });

  it('still returns the rows it did gather when the backfill fell short', async () => {
    const stalled = succeed({ items: [lateRow], nextCursor: false });
    const state = await scrapeWith([stalled, stalled]);
    expect(state.accounts[0].txns).toHaveLength(1);
  });

  it('flags the scrape when any one account fell short', async () => {
    const accts = [
      { id: 'quiet', num: 'num-1' },
      { id: 'short', num: 'num-2' },
    ];
    const bus = makeRouterBus({
      customer: [succeed({ accts })],
      balance: [succeed({ balance: 1 }), succeed({ balance: 2 })],
      transactions: [
        succeed({ items: [earlyRow], nextCursor: false }),
        succeed({ items: [lateRow], nextCursor: false }),
        succeed({ items: [lateRow], nextCursor: false }),
      ],
    });
    const state = await stateFrom(bus);
    expect(state.backfillExhausted).toBe(true);
  });
});

/**
 * Stop predicate — halts once one row is collected.
 * @param acc - Accumulator collected so far.
 * @returns True when one row is already in the accumulator.
 */
function stopAfterOne(acc: readonly object[]): boolean {
  return acc.length >= 1;
}
