/**
 * Shared router-backed mock mediator for ApiDirectScrape specs.
 *
 * <p>Extracted from three byte-identical copies that had drifted apart
 * (`ApiDirectScrapePhase.test.ts`, `ApiDirectScrapeSelfHeal.test.ts` and the
 * issue #550 reproduction) — `CLAUDE.md`: factories over duplication, tests
 * must not duplicate production logic or each other.
 *
 * <p>The recovery stubs are always spread in. That is safe for the self-heal
 * spec, which `Object.assign`s its own `recoverSession` / `wasSessionWarm` /
 * `setSessionWarm` over the returned bus, so its overrides still win.
 *
 * <p>An operation with an exhausted queue deliberately yields a typed failure
 * rather than a silent `undefined`: a spec that issues MORE calls than it
 * queued is asserting something it did not intend, and must fail loudly. Issue
 * #550 relies on this — it is how "an unsupported product was never requested"
 * is proven.
 */

import { jest } from '@jest/globals';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import type { IApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeRecoverySessionStubs } from '../../Infrastructure/MockFactories.js';

/** Ordered per-operation response queue keyed by operation label. */
type RouterQueues = Record<string, readonly Procedure<unknown>[]>;

/**
 * Copy each queue so a spec's fixture array is never mutated between runs.
 * @param router - Per-op ordered response queue.
 * @returns Mutable per-op queues.
 */
function cloneQueues(router: RouterQueues): Record<string, Procedure<unknown>[]> {
  const queues: Record<string, Procedure<unknown>[]> = {};
  for (const key of Object.keys(router)) queues[key] = [...router[key]];
  return queues;
}

/**
 * Build the queue-shifting router function.
 * @param queues - Mutable per-op queues.
 * @returns Router that shifts one response per call.
 */
function buildRoute(
  queues: Record<string, Procedure<unknown>[]>,
): (op: string) => Promise<Procedure<unknown>> {
  return async function route(op: string): Promise<Procedure<unknown>> {
    await Promise.resolve();
    const head = (queues[op] ?? []).shift();
    if (head) return head;
    return fail(ScraperErrorTypes.Generic, `no stub for op=${op}`);
  };
}

/**
 * Build a router-backed mock mediator that shifts one queued response per
 * operation call.
 * @param router - Per-op ordered response queue.
 * @returns Mock mediator.
 */
export function makeRouterBus(router: RouterQueues): IApiMediator {
  const queues = cloneQueues(router);
  const route = buildRoute(queues);
  const apiQuery = jest.fn(route);
  return {
    apiPost: jest.fn(),
    apiGet: jest.fn(),
    apiQuery,
    setBearer: jest.fn(),
    setRawAuth: jest.fn(),
    setSessionContext: jest.fn((): boolean => true),
    ...makeRecoverySessionStubs(),
    getSessionContext: jest.fn((): Readonly<Record<string, unknown>> => ({})),
  } as unknown as IApiMediator;
}

export type { RouterQueues };
