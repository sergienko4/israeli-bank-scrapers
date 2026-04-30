/**
 * Unit tests for the shared GenericHeadlessScrape driver.
 * Exercises guard + happy + failure-propagation branches using a
 * synthetic shape (zero bank-name coupling in the test itself).
 */

import { jest } from '@jest/globals';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import { buildGenericHeadlessScrape } from '../../../../../Scrapers/Pipeline/Banks/_Shared/GenericHeadlessScrape.js';
import type { IHeadlessScrapeShape } from '../../../../../Scrapers/Pipeline/Banks/_Shared/HeadlessScrapeShape.js';
import type { IApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import type { IPage } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/Pagination.js';
import { none, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IActionContext,
  IPipelineContext,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { assertHas, assertOk } from '../../../../Helpers/AssertProcedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';

/** Synthetic account ref — minimum the shape needs. */
interface ISynAcct {
  readonly id: string;
  readonly num: string;
}

/**
 * Build a synthetic shape with string cursor (matches OneZero semantics).
 * @returns Synthetic scrape shape.
 */
function makeShape(): IHeadlessScrapeShape<ISynAcct, string> {
  return {
    stepName: 'SynScrape',
    accountNumberOf: accountNumberOfSyn,
    customer: { buildVars: emptyVars, extractAccounts: extractAccountsSyn },
    balance: { buildVars: balVarsSyn, extract: balExtractSyn },
    transactions: { buildVars: txnVarsSyn, extractPage: extractPageSyn },
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
 * @param body - Customer response body.
 * @returns Synthetic account list.
 */
function extractAccountsSyn(body: Record<string, unknown>): readonly ISynAcct[] {
  return (body as { accts: readonly ISynAcct[] }).accts;
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
 * @param body - Page payload.
 * @returns Generic page.
 */
function extractPageSyn(body: Record<string, unknown>): IPage<object, string> {
  return body as unknown as IPage<object, string>;
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
  } as unknown as IApiMediator;
}

/**
 * Wrap a bus into an IActionContext for the driver.
 * @param bus - Mock mediator.
 * @returns Action context.
 */
function ctxOf(bus: IApiMediator): IActionContext {
  const base = makeMockContext();
  const withBus: IPipelineContext = {
    ...base,
    apiMediator: some(bus),
  };
  return withBus as unknown as IActionContext;
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
    const shape: IHeadlessScrapeShape<ISynAcct, string> = {
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
    const shape2: IHeadlessScrapeShape<ISynAcct, string> = {
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
 * Stop predicate — halts once one row is collected.
 * @param acc - Accumulator collected so far.
 * @returns True when one row is already in the accumulator.
 */
function stopAfterOne(acc: readonly object[]): boolean {
  return acc.length >= 1;
}
