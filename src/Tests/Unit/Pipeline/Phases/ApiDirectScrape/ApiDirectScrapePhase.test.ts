/**
 * Unit tests for the ApiDirectScrape phase wrapper + ported actions.
 *
 * Restructured into cross-bank parameterised cases via
 * {@link ./ApiDirectScrapeBankShapes!ALL_BANK_CASES}: every scenario that
 * touches a shape's extractor surface runs against the real
 * `PEPPER_SHAPE` and `ONE_ZERO_SHAPE` alongside a synthetic
 * baseline, so a regression in any bank's helpers fails here first.
 * Scenarios with no per-bank variance (driver guards, accumulator
 * short-circuit) stay on the synthetic case to keep the suite lean.
 */

import { jest } from '@jest/globals';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import type { IApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import {
  buildApiDirectScrapePhase,
  createApiDirectScrapePhase,
} from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapePhase.js';
import type { IApiDirectScrapeShape } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { none, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IActionContext,
  IPipelineContext,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { assertHas, assertOk } from '../../../../Helpers/AssertProcedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';
import {
  ALL_BANK_CASES,
  type AnyBankCase,
  ONEZERO_CASE,
  PEPPER_CASE,
  SYN_CASE,
} from './ApiDirectScrapeBankShapes.js';

/** Pepper headers consult ctx.credentials.phoneNumber — provide one for the real shape. */
const PEPPER_TEST_CREDENTIALS = {
  username: 'pepper-test-user',
  password: 'pepper-test-pass',
  phoneNumber: '972541234567',
} as unknown as IPipelineContext['credentials'];

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
 * Wrap a bus into an IActionContext suitable for the bound case.
 * Pepper's dynamic-headers function reads `ctx.credentials.phoneNumber`;
 * other cases run on the default credentials supplied by makeMockContext.
 * @param bus - Mock mediator.
 * @param caseName - Bank case identifier (controls credential override).
 * @returns Action context.
 */
function ctxOf(bus: IApiMediator, caseName: string): IActionContext {
  const credsOverride =
    caseName === PEPPER_CASE.name ? { credentials: PEPPER_TEST_CREDENTIALS } : {};
  const base = makeMockContext({ apiMediator: some(bus), ...credsOverride });
  return base as unknown as IActionContext;
}

/**
 * Build a router pre-loaded for the happy path of a parameterised case.
 * @param bankCase - Parameterised bank shape case.
 * @returns Mediator pre-loaded for customer + balance + transactions.
 */
function busForHappyPath(bankCase: AnyBankCase): IApiMediator {
  return makeRouterBus({
    customer: [succeed(bankCase.fixtures.customer)],
    balance: [succeed(bankCase.fixtures.balance)],
    transactions: [succeed(bankCase.fixtures.transactions)],
  });
}

/**
 * Helper — run the bound phase against a router-backed mediator.
 * @param bankCase - Parameterised bank shape case.
 * @param bus - Pre-loaded mediator.
 * @returns Procedure emitted by the phase.
 */
async function runPhase(
  bankCase: AnyBankCase,
  bus: IApiMediator,
): Promise<Procedure<IPipelineContext>> {
  const phase = createApiDirectScrapePhase(bankCase.shape);
  const ctx = ctxOf(bus, bankCase.name);
  return phase(ctx);
}

describe.each(ALL_BANK_CASES)('createApiDirectScrapePhase — $name', bankCase => {
  it('ADS-PRE-1 — resolves mediator + extracts accounts', async () => {
    const bus = busForHappyPath(bankCase);
    const result = await runPhase(bankCase, bus);
    assertOk(result);
    const scr = result.value.scrape;
    assertHas(scr);
    expect(scr.value.accounts).toHaveLength(1);
    expect(scr.value.accounts[0].accountNumber).toBe(bankCase.fixtures.expectedAccountNumber);
  });

  it('ADS-ACT-1 — single acct + single page → one ITransactionsAccount', async () => {
    const bus = busForHappyPath(bankCase);
    const result = await runPhase(bankCase, bus);
    assertOk(result);
    const scr = result.value.scrape;
    assertHas(scr);
    expect(scr.value.accounts).toHaveLength(1);
    expect(scr.value.accounts[0].balance).toBe(bankCase.fixtures.expectedBalance);
    expect(scr.value.accounts[0].accountNumber).toBe(bankCase.fixtures.expectedAccountNumber);
  });

  it('ADS-ACT-2 — real shape metadata (extraHeaders / stop) drives a clean run', async () => {
    const bus = makeRouterBus({
      customer: [succeed(bankCase.fixtures.customer)],
      balance: [succeed(bankCase.fixtures.balance)],
      // Two pages queued — the second is only reached when stop returns false
      // and the first page's cursor is non-false. Each real shape terminates
      // on the first page (Pepper: rows < PAGE_SIZE; OneZero: hasMore=false).
      transactions: [
        succeed(bankCase.fixtures.transactions),
        succeed(bankCase.fixtures.transactionsPaged),
      ],
    });
    const result = await runPhase(bankCase, bus);
    assertOk(result);
  });
});

describe.each([SYN_CASE, PEPPER_CASE] as readonly AnyBankCase[])(
  'createApiDirectScrapePhase ADS-ACT-3 — $name (no fallback)',
  bankCase => {
    it('balance fail without fallback propagates', async () => {
      const balFail = fail(ScraperErrorTypes.Generic, 'bal bad');
      const bus = makeRouterBus({
        customer: [succeed(bankCase.fixtures.customer)],
        balance: [balFail],
      });
      const result = await runPhase(bankCase, bus);
      expect(result.success).toBe(false);
    });
  },
);

describe.each([SYN_CASE, ONEZERO_CASE] as readonly AnyBankCase[])(
  'createApiDirectScrapePhase ADS-ACT-4 — $name (with fallback)',
  bankCase => {
    it('balance fail with fallback yields balance from fallbackOnFail', async () => {
      const balFail = fail(ScraperErrorTypes.Generic, 'bal bad');
      const bus = makeRouterBus({
        customer: [succeed(bankCase.fixtures.customer)],
        balance: [balFail],
        transactions: [succeed(bankCase.fixtures.transactions)],
      });
      // Synthetic case has no fallback in its real shape — override here so
      // the SYN parameterisation still exercises the driver's fallback path
      // without polluting the shared synthetic registry entry.
      const shapeWithFallback: IApiDirectScrapeShape<unknown, unknown> = {
        ...bankCase.shape,
        balance: {
          ...bankCase.shape.balance,
          fallbackOnFail: bankCase.fixtures.fallbackBalance ?? 0,
        },
      };
      const phase = createApiDirectScrapePhase(shapeWithFallback);
      const ctx = ctxOf(bus, bankCase.name);
      const result = await phase(ctx);
      assertOk(result);
      const scr = result.value.scrape;
      assertHas(scr);
      expect(scr.value.accounts[0].balance).toBe(bankCase.fixtures.fallbackBalance ?? 0);
    });
  },
);

describe('createApiDirectScrapePhase (synthetic-only edge cases)', () => {
  /**
   * ADS-PRE-2 covers the driver-level guard before any shape is consulted,
   * so a single synthetic case proves the contract.
   */
  it('ADS-PRE-2 — fails with "ApiMediator missing" when slot empty', async () => {
    const phase = createApiDirectScrapePhase(
      SYN_CASE.shape as IApiDirectScrapeShape<unknown, unknown>,
    );
    const base = makeMockContext({ apiMediator: none() });
    const ctx = base as unknown as IActionContext;
    const result = await phase(ctx);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('ApiMediator missing');
  });

  it('ADS-FIN-1 — customer fail short-circuits without scrape slot', async () => {
    const customerFail = fail(ScraperErrorTypes.Generic, 'cust bad');
    const bus = makeRouterBus({ customer: [customerFail] });
    const result = await runPhase(SYN_CASE as unknown as AnyBankCase, bus);
    expect(result.success).toBe(false);
  });

  it('ADS-ACT-5 — transactions page fail propagates per account', async () => {
    const txnFail = fail(ScraperErrorTypes.Generic, 'txn bad');
    const bus = makeRouterBus({
      customer: [succeed(SYN_CASE.fixtures.customer)],
      balance: [succeed(SYN_CASE.fixtures.balance)],
      transactions: [txnFail],
    });
    const result = await runPhase(SYN_CASE as unknown as AnyBankCase, bus);
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
    const result = await runPhase(SYN_CASE as unknown as AnyBankCase, bus);
    expect(result.success).toBe(false);
  });
});

describe('buildApiDirectScrapePhase (Commit E — BasePhase wrapper)', () => {
  it('ADS-WR-1 — wrapper carries name "api-direct-scrape"', () => {
    const phase = buildApiDirectScrapePhase(
      SYN_CASE.shape as IApiDirectScrapeShape<unknown, unknown>,
    );
    expect(phase.name).toBe('api-direct-scrape');
  });

  it('ADS-WR-2 — action() delegates to the bound scrape fn', async () => {
    const bus = makeRouterBus({ customer: [succeed({ accts: [] })] });
    const phase = buildApiDirectScrapePhase(
      SYN_CASE.shape as IApiDirectScrapeShape<unknown, unknown>,
    );
    const ctx = ctxOf(bus, SYN_CASE.name);
    const result = await phase.action(ctx, ctx);
    expect(result.success).toBe(true);
  });
});
