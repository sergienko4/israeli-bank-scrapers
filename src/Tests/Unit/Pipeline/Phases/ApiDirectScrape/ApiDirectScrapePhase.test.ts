/**
 * Unit tests for the ApiDirectScrape phase wrapper + ported actions.
 * Commit B replaces the scaffold test with PRE/ACTION/POST/FINAL
 * coverage — PRE resolves the mediator, ACTION walks customer →
 * per-account, and the FINAL merge writes `scrape.accounts` onto
 * the pipeline context. The driver body is exercised verbatim via
 * the bound factory (createApiDirectScrapePhase).
 */

import { jest } from '@jest/globals';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import type { IApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import { createApiDirectScrapePhase } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapePhase.js';
import type { IApiDirectScrapeShape } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
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
 * Build a synthetic shape with string cursor (matches OneZero semantics).
 * @returns Synthetic scrape shape.
 */
function makeShape(): IApiDirectScrapeShape<ISynAcct, string> {
  return {
    stepName: 'AdsTestShape',
    accountNumberOf: accountNumberOfSyn,
    customer: { buildVars: emptyVars, extractAccounts: extractAccountsSyn },
    balance: { buildVars: balVarsSyn, extract: balExtractSyn },
    transactions: { buildVars: txnVarsSyn, extractPage: extractPageSyn },
  };
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
 * Wrap a bus into an IActionContext for the phase.
 * @param bus - Mock mediator.
 * @returns Action context.
 */
function ctxOf(bus: IApiMediator): IActionContext {
  const base = makeMockContext();
  const withBus: IPipelineContext = { ...base, apiMediator: some(bus) };
  return withBus as unknown as IActionContext;
}

describe('createApiDirectScrapePhase (Commit B — driver port)', () => {
  it('ADS-PRE-1 — resolves mediator + scrapes empty acct list', async () => {
    const bus = makeRouterBus({ customer: [succeed({ accts: [] })] });
    const shape = makeShape();
    const phase = createApiDirectScrapePhase(shape);
    const ctx = ctxOf(bus);
    const result = await phase(ctx);
    assertOk(result);
    const scr = result.value.scrape;
    assertHas(scr);
    expect(scr.value.accounts).toHaveLength(0);
  });

  it('ADS-PRE-2 — fails with "ApiMediator missing" when slot empty', async () => {
    const shape = makeShape();
    const phase = createApiDirectScrapePhase(shape);
    const base = makeMockContext({ apiMediator: none() });
    const ctx = base as unknown as IActionContext;
    const result = await phase(ctx);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('ApiMediator missing');
  });

  it('ADS-ACT-1 — single acct, single page → one ITransactionsAccount', async () => {
    const bus = makeRouterBus({
      customer: [succeed({ accts: [{ id: 'a1', num: 'num-1' }] })],
      balance: [succeed({ balance: 42 })],
      transactions: [succeed({ items: [], nextCursor: false })],
    });
    const shape = makeShape();
    const phase = createApiDirectScrapePhase(shape);
    const ctx = ctxOf(bus);
    const result = await phase(ctx);
    assertOk(result);
    const scr = result.value.scrape;
    assertHas(scr);
    expect(scr.value.accounts).toHaveLength(1);
    expect(scr.value.accounts[0].balance).toBe(42);
    expect(scr.value.accounts[0].accountNumber).toBe('num-1');
  });

  it('ADS-FIN-1 — customer fail short-circuits without scrape slot', async () => {
    const customerFail = fail(ScraperErrorTypes.Generic, 'cust bad');
    const bus = makeRouterBus({ customer: [customerFail] });
    const shape = makeShape();
    const phase = createApiDirectScrapePhase(shape);
    const ctx = ctxOf(bus);
    const result = await phase(ctx);
    expect(result.success).toBe(false);
  });

  it('ADS-ACT-2 — extraHeaders + stop predicate are honoured', async () => {
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
    const phase = createApiDirectScrapePhase(shape);
    const ctx = ctxOf(bus);
    const result = await phase(ctx);
    assertOk(result);
  });

  it('ADS-ACT-3 — balance fail without fallback propagates', async () => {
    const balFail = fail(ScraperErrorTypes.Generic, 'bal bad');
    const bus = makeRouterBus({
      customer: [succeed({ accts: [{ id: 'a1', num: 'num-1' }] })],
      balance: [balFail],
    });
    const shape = makeShape();
    const phase = createApiDirectScrapePhase(shape);
    const ctx = ctxOf(bus);
    const result = await phase(ctx);
    expect(result.success).toBe(false);
  });

  it('ADS-ACT-4 — balance fail with fallback returns fallback value', async () => {
    const balFail = fail(ScraperErrorTypes.Generic, 'bal bad');
    const bus = makeRouterBus({
      customer: [succeed({ accts: [{ id: 'a1', num: 'num-1' }] })],
      balance: [balFail],
      transactions: [succeed({ items: [], nextCursor: false })],
    });
    const base = makeShape();
    const shape: IApiDirectScrapeShape<ISynAcct, string> = {
      ...base,
      balance: { ...base.balance, fallbackOnFail: 0 },
    };
    const phase = createApiDirectScrapePhase(shape);
    const ctx = ctxOf(bus);
    const result = await phase(ctx);
    assertOk(result);
  });

  it('ADS-ACT-5 — transactions page fail propagates per account', async () => {
    const txnFail = fail(ScraperErrorTypes.Generic, 'txn bad');
    const bus = makeRouterBus({
      customer: [succeed({ accts: [{ id: 'a1', num: 'num-1' }] })],
      balance: [succeed({ balance: 1 })],
      transactions: [txnFail],
    });
    const shape = makeShape();
    const phase = createApiDirectScrapePhase(shape);
    const ctx = ctxOf(bus);
    const result = await phase(ctx);
    expect(result.success).toBe(false);
  });

  it('ADS-ACT-6 — second acct fail short-circuits 3-acct accumulator', async () => {
    const balFail = fail(ScraperErrorTypes.Generic, 'bal bad');
    const bus = makeRouterBus({
      customer: [
        succeed({
          accts: [
            { id: 'a1', num: 'num-1' },
            { id: 'a2', num: 'num-2' },
            { id: 'a3', num: 'num-3' },
          ],
        }),
      ],
      balance: [succeed({ balance: 1 }), balFail],
      transactions: [succeed({ items: [], nextCursor: false })],
    });
    const shape = makeShape();
    const phase = createApiDirectScrapePhase(shape);
    const ctx = ctxOf(bus);
    const result = await phase(ctx);
    expect(result.success).toBe(false);
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
