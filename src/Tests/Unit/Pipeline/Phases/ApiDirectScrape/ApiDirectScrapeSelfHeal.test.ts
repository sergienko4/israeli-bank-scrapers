/**
 * Unit tests for the direct-API warm-session self-heal wrapper
 * ({@link ../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapeActions!buildGenericHeadlessScrape}).
 *
 * A cached "warm" long-term token is only an optimization: when a warm scrape
 * yields a suspicious outcome (hard failure OR degraded balance — the server
 * silently rejecting a locally-fresh token), the wrapper discards it, runs the
 * full cold re-login via `recoverSession`, and re-scrapes ONCE. The mechanism
 * is shared by every api-direct bank with zero per-bank coupling, so the warm +
 * degraded scenario runs cross-bank over the synthetic, Pepper and OneZero
 * shapes; the gating + recovery-failure edges run on the synthetic case.
 */

import { jest } from '@jest/globals';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import type { IApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import { createApiDirectScrapePhase } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapePhase.js';
import type { IApiDirectScrapeShape } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IActionContext,
  IPipelineContext,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { assertHas, assertOk } from '../../../../Helpers/AssertProcedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';
import {
  type AnyBankCase,
  ONEZERO_CASE,
  PEPPER_CASE,
  SYN_CASE,
} from './ApiDirectScrapeBankShapes.js';

/** Pepper headers consult ctx.credentials.phoneNumber — provide one for the real shape. */
const PEPPER_TEST_CREDENTIALS = {
  username: 'pepper-test-user',
  password: 'pepper-test-pass',
  phoneNumber: '972000000001',
} as unknown as IPipelineContext['credentials'];

/** Arguments for {@link makeSelfHealBus}. */
interface ISelfHealArgs {
  readonly router: Record<string, readonly Procedure<unknown>[]>;
  readonly isWarm: boolean;
  readonly recover: Procedure<string>;
}

/** A self-heal bus plus its recoverSession spy for call-count assertions. */
interface ISelfHealHandle {
  readonly bus: IApiMediator;
  readonly recoverSession: jest.Mock;
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
    getSessionContext: jest.fn((): Readonly<Record<string, unknown>> => ({})),
  } as unknown as IApiMediator;
}

/**
 * Extend a router-backed bus with the warm-session recovery primitives so the
 * self-heal wrapper can read warmth and drive a (mocked) cold re-login.
 * @param args - Router queues + warm flag + canned recovery outcome.
 * @returns The augmented bus plus its recoverSession spy.
 */
function makeSelfHealBus(args: ISelfHealArgs): ISelfHealHandle {
  const bus = makeRouterBus(args.router);
  const recoverSession = jest.fn((): Promise<Procedure<string>> => Promise.resolve(args.recover));
  const wasSessionWarm = jest.fn((): boolean => args.isWarm);
  const setSessionWarm = jest.fn((value: boolean): boolean => value);
  Object.assign(bus, { recoverSession, wasSessionWarm, setSessionWarm });
  return { bus, recoverSession };
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
 * Override a case's balance step with a fallback so a failed balance fetch
 * degrades (rather than hard-failing) — the warm-token-rejected signal.
 * @param bankCase - Parameterised bank case.
 * @returns Shape whose balance step falls back on failure.
 */
function degradedShape(bankCase: AnyBankCase): IApiDirectScrapeShape<unknown, unknown> {
  return {
    ...bankCase.shape,
    balance: { ...bankCase.shape.balance, fallbackOnFail: bankCase.fixtures.fallbackBalance ?? 0 },
  };
}

const BALANCE_REJECTED = fail(ScraperErrorTypes.Generic, 'warm token rejected');

describe.each([SYN_CASE, PEPPER_CASE, ONEZERO_CASE] as readonly AnyBankCase[])(
  'ApiDirectScrape self-heal — $name',
  bankCase => {
    it('SH-1 — warm + degraded balance recovers once and heals', async () => {
      const { bus, recoverSession } = makeSelfHealBus({
        router: {
          customer: [succeed(bankCase.fixtures.customer), succeed(bankCase.fixtures.customer)],
          balance: [BALANCE_REJECTED, succeed(bankCase.fixtures.balance)],
          transactions: [
            succeed(bankCase.fixtures.transactions),
            succeed(bankCase.fixtures.transactions),
          ],
        },
        isWarm: true,
        recover: succeed('fresh-cold-token'),
      });
      const shape = degradedShape(bankCase);
      const phase = createApiDirectScrapePhase(shape);
      const ctx = ctxOf(bus, bankCase.name);
      const result = await phase(ctx);
      assertOk(result);
      const scr = result.value.scrape;
      assertHas(scr);
      expect(recoverSession).toHaveBeenCalledTimes(1);
      expect(scr.value.balanceDegraded).toBe(false);
      expect(scr.value.accounts[0].balance).toBe(bankCase.fixtures.expectedBalance);
    });
  },
);

describe('ApiDirectScrape self-heal — gating + recovery failure (synthetic)', () => {
  const synShape = SYN_CASE.shape as IApiDirectScrapeShape<unknown, unknown>;

  it('SH-2 — warm + healthy takes the fast path (no recovery)', async () => {
    const { bus, recoverSession } = makeSelfHealBus({
      router: {
        customer: [succeed(SYN_CASE.fixtures.customer)],
        balance: [succeed(SYN_CASE.fixtures.balance)],
        transactions: [succeed(SYN_CASE.fixtures.transactions)],
      },
      isWarm: true,
      recover: succeed('unused'),
    });
    const phase = createApiDirectScrapePhase(synShape);
    const ctx = ctxOf(bus, SYN_CASE.name);
    const result = await phase(ctx);
    assertOk(result);
    const scr = result.value.scrape;
    assertHas(scr);
    expect(recoverSession).not.toHaveBeenCalled();
    expect(scr.value.balanceDegraded).toBe(false);
  });

  it('SH-3 — cold + degraded does not recover (no double OTP)', async () => {
    const { bus, recoverSession } = makeSelfHealBus({
      router: {
        customer: [succeed(SYN_CASE.fixtures.customer)],
        balance: [BALANCE_REJECTED],
        transactions: [succeed(SYN_CASE.fixtures.transactions)],
      },
      isWarm: false,
      recover: succeed('unused'),
    });
    const shape = degradedShape(SYN_CASE as AnyBankCase);
    const phase = createApiDirectScrapePhase(shape);
    const ctx = ctxOf(bus, SYN_CASE.name);
    const result = await phase(ctx);
    assertOk(result);
    const scr = result.value.scrape;
    assertHas(scr);
    expect(recoverSession).not.toHaveBeenCalled();
    expect(scr.value.balanceDegraded).toBe(true);
  });

  it('SH-4 — warm + hard-fail + recover fails surfaces the failure', async () => {
    const { bus, recoverSession } = makeSelfHealBus({
      router: {
        customer: [succeed(SYN_CASE.fixtures.customer)],
        balance: [fail(ScraperErrorTypes.Generic, 'balance down')],
      },
      isWarm: true,
      recover: fail(ScraperErrorTypes.Generic, 'cold re-login failed'),
    });
    const phase = createApiDirectScrapePhase(synShape);
    const ctx = ctxOf(bus, SYN_CASE.name);
    const result = await phase(ctx);
    expect(result.success).toBe(false);
    expect(recoverSession).toHaveBeenCalledTimes(1);
  });

  it('SH-5 — warm + degraded + recover fails keeps degraded unmasked', async () => {
    const { bus, recoverSession } = makeSelfHealBus({
      router: {
        customer: [succeed(SYN_CASE.fixtures.customer)],
        balance: [BALANCE_REJECTED],
        transactions: [succeed(SYN_CASE.fixtures.transactions)],
      },
      isWarm: true,
      recover: fail(ScraperErrorTypes.Generic, 'cold re-login failed'),
    });
    const shape = degradedShape(SYN_CASE as AnyBankCase);
    const phase = createApiDirectScrapePhase(shape);
    const ctx = ctxOf(bus, SYN_CASE.name);
    const result = await phase(ctx);
    assertOk(result);
    const scr = result.value.scrape;
    assertHas(scr);
    expect(recoverSession).toHaveBeenCalledTimes(1);
    expect(scr.value.balanceDegraded).toBe(true);
  });

  it('SH-6 — warm + transient-shaped balance fallback still recovers', async () => {
    const transient = fail(ScraperErrorTypes.Generic, '503: service unavailable');
    const { bus, recoverSession } = makeSelfHealBus({
      router: {
        customer: [succeed(SYN_CASE.fixtures.customer), succeed(SYN_CASE.fixtures.customer)],
        balance: [transient, succeed(SYN_CASE.fixtures.balance)],
        transactions: [
          succeed(SYN_CASE.fixtures.transactions),
          succeed(SYN_CASE.fixtures.transactions),
        ],
      },
      isWarm: true,
      recover: succeed('fresh-cold-token'),
    });
    const shape = degradedShape(SYN_CASE as AnyBankCase);
    const phase = createApiDirectScrapePhase(shape);
    const ctx = ctxOf(bus, SYN_CASE.name);
    const result = await phase(ctx);
    assertOk(result);
    expect(recoverSession).toHaveBeenCalledTimes(1);
  });
});
