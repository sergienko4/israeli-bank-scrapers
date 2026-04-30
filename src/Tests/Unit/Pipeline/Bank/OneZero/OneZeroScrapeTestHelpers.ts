/**
 * Shared helpers for OneZero scrape unit tests — synthetic portfolios,
 * GraphQL envelopes, a router-backed mock IApiMediator, and a context
 * factory that mirrors the executor's headless-mode mediator wiring.
 * All fixture data here is synthetic — Rule #18.
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
import { makeMockContext, makeMockOptions } from '../../Infrastructure/MockFactories.js';

/** Synthetic portfolio shape — minimum fields consumed by the scraper. */
export const SYN_PORTFOLIO_1 = {
  portfolioId: 'pf-syn-001',
  portfolioNum: 'num-syn-001',
  accounts: [{ accountId: 'acc-syn-001' }],
};

/** Second synthetic portfolio (multi-portfolio tests). */
export const SYN_PORTFOLIO_2 = {
  portfolioId: 'pf-syn-002',
  portfolioNum: 'num-syn-002',
  accounts: [{ accountId: 'acc-syn-002' }],
};

/**
 * Build a synthetic movement record — one field from each WK auto-mapper group.
 * @param id - Movement identifier.
 * @param amount - Signed amount value.
 * @param iso - ISO timestamp string.
 * @returns Opaque raw movement.
 */
export function synMovement(id: string, amount: number, iso: string): Record<string, unknown> {
  return {
    movementId: id,
    movementTimestamp: iso,
    movementAmount: amount,
    description: `syn-desc-${id}`,
  };
}

/**
 * GraphQL envelope for the customer query (portfolios list).
 * @param portfolios - Portfolios to return.
 * @returns Envelope compatible with OneZeroScrape.fetchPortfolios.
 */
export function customerEnvelope(
  portfolios: readonly (typeof SYN_PORTFOLIO_1)[],
): Record<string, unknown> {
  return { customer: [{ portfolios }] };
}

/**
 * GraphQL envelope for the movements query.
 * @param movements - Raw movements for this page.
 * @param hasMore - GraphQL hasMore flag.
 * @param cursor - GraphQL cursor string, or empty to signal "no cursor".
 * @returns Envelope compatible with OneZeroScrape.fetchMovementsPage.
 */
export function movementsEnvelope(
  movements: readonly Record<string, unknown>[],
  hasMore: boolean,
  cursor: string,
): Record<string, unknown> {
  return { movements: { movements, pagination: { hasMore, cursor } } };
}

/**
 * GraphQL envelope for the balance query.
 * @param balance - Balance value.
 * @returns Envelope compatible with OneZeroScrape.fetchBalance.
 */
export function balanceEnvelope(balance: number): Record<string, unknown> {
  return { balance: { currentAccountBalance: balance } };
}

/** Router map: operation name → ordered list of Procedure responses. */
export type OpRouter = Record<string, readonly Procedure<Record<string, unknown>>[]>;

/**
 * Build a generic failure Procedure.
 * @param msg - Fail message.
 * @returns Failure Procedure.
 */
export function failGeneric(msg: string): ReturnType<typeof fail> {
  return fail(ScraperErrorTypes.Generic, msg);
}

/**
 * Shift the next response for an operation, or return a canned failure.
 * @param queues - Mutable per-operation queues.
 * @param op - Operation key.
 * @returns Next procedure or a generic fail.
 */
function popResponse(
  queues: Record<string, Procedure<Record<string, unknown>>[]>,
  op: string,
): Procedure<Record<string, unknown>> {
  const queue = queues[op] ?? [];
  if (queue.length === 0) return failGeneric(`no stub for op=${op}`);
  const head = queue.shift();
  if (head === undefined) return failGeneric('empty');
  return head;
}

/**
 * Build a mediator whose apiQuery routes by operation label.
 * @param router - Per-operation procedure queue.
 * @returns Mock mediator instance.
 */
export function makeMediator(router: OpRouter): IApiMediator {
  const queues: Record<string, Procedure<Record<string, unknown>>[]> = {};
  for (const key of Object.keys(router)) queues[key] = [...router[key]];
  /**
   * Async router for apiQuery — shifts the per-op queue.
   * @param op - Operation key from the caller.
   * @returns Next queued procedure or a generic fail.
   */
  async function route(op: string): Promise<Procedure<Record<string, unknown>>> {
    await Promise.resolve();
    return popResponse(queues, op);
  }
  const apiQuery = jest.fn().mockImplementation(route);
  return {
    apiPost: jest.fn(),
    apiGet: jest.fn(),
    apiQuery,
    setBearer: jest.fn(),
  } as unknown as IApiMediator;
}

/**
 * Build a start-date seeded mock context with the mediator slot populated.
 * @param bus - The mock mediator.
 * @returns Action context with mediator populated.
 */
export function makeCtx(bus: IApiMediator): IActionContext {
  const opts = makeMockOptions({ startDate: new Date('2024-01-01') });
  const base = makeMockContext({ options: opts });
  const withMediator: IPipelineContext = {
    ...base,
    apiMediator: some(bus) as unknown as IPipelineContext['apiMediator'],
  };
  return withMediator as unknown as IActionContext;
}
