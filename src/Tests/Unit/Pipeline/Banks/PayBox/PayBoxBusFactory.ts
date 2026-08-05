/**
 * Shared PayBox test factory — router-backed mock mediator plus the
 * action-context wrapper used by every PayBox scrape suite.
 *
 * Extracted from PayBoxShape.test.ts so the wallet-row quality suite
 * reuses one mediator definition instead of cloning it, per
 * `mocking-test-guidlines.md` ("prefer helper/builders/factories over
 * global setup"). All fixtures are synthetic — no real PII.
 */

import { jest } from '@jest/globals';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import type { IApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IActionContext,
  IPipelineContext,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext, makeRecoverySessionStubs } from '../../Infrastructure/MockFactories.js';

/** Synthetic PayBox user id surfaced as the wallet account number. */
export const FIXT_UID = 'pb-uid-fixture-1';
/** Synthetic 16-hex device id carried in the auth envelope. */
export const FIXT_DEVICE = 'fixt-device-pb-0001';
/** Synthetic bearer token carried in the auth envelope. */
export const FIXT_TOKEN = 'fixt-jwt-pb-0001';

/** PayBox session-context fixture used by extractAccountsFromSessionContext. */
export const PAYBOX_SESSION: Readonly<Record<string, unknown>> = Object.freeze({
  uId: FIXT_UID,
  deviceId16Hex: FIXT_DEVICE,
  token: FIXT_TOKEN,
});

/** Route per-call apiPost dispatch via the WK URL tag. */
const URL_TAG_TO_OP: Readonly<Record<string, 'balance' | 'transactions'>> = {
  'data.sync': 'balance',
  'data.getUserHistory': 'transactions',
  'data.virtualCardTranRequest': 'transactions',
};

/** Per-operation ordered response queues consumed by the mock mediator. */
export type PayBoxRouter = Record<string, readonly Procedure<unknown>[]>;

/**
 * Build a router-backed mock mediator pre-seeded with PayBox session.
 * @param router - Per-op ordered response queue.
 * @returns Mock mediator.
 */
export function makePayBoxBus(router: PayBoxRouter): IApiMediator {
  const queues: Record<string, Procedure<unknown>[]> = {};
  for (const key of Object.keys(router)) queues[key] = [...router[key]];
  /**
   * Shift the queue for an operation, surfacing a clear failure when empty.
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
  const apiPost = jest.fn((urlTag: string) => route(URL_TAG_TO_OP[urlTag] ?? 'customer'));
  return {
    apiPost,
    apiGet: jest.fn(),
    apiQuery: jest.fn(route),
    setBearer: jest.fn(),
    setRawAuth: jest.fn(),
    setSessionContext: jest.fn(),
    ...makeRecoverySessionStubs(),
    getSessionContext: jest.fn((): Readonly<Record<string, unknown>> => PAYBOX_SESSION),
  } as unknown as IApiMediator;
}

/**
 * Build an IActionContext wired with the PayBox bus.
 * @param bus - Mock mediator.
 * @returns Action context.
 */
export function ctxOf(bus: IApiMediator): IActionContext {
  const overrides: Partial<IPipelineContext> = { apiMediator: some(bus) };
  const base = makeMockContext(overrides);
  return base as unknown as IActionContext;
}
