/**
 * BalanceResolveActions.Captured — seed balance responses from the
 * already-captured network pool (no extra request).
 *
 * <p>Some browser banks (e.g. Bank Leumi) fold the account balance into
 * the SAME response that carried the transactions — Leumi's
 * `UC_SO_27_GetBusinessAccountTrx` response exposes `BalanceDisplay`
 * (and per-row `RunningBalance`) and there is no separately-addressable
 * balance endpoint. SCRAPE.post therefore emits only the loose bulk
 * fallback template, and the live BALANCE-RESOLVE re-fetch is
 * quarantined. The authoritative balance is already in the captured
 * pool, so read it there and let it fill genuine fetch misses.
 *
 * <p>Default-deny: returns an empty map when no captured body carries a
 * balance. The result is keyed under {@link BULK_KEY} so the per-card
 * extractor's bulk fallback finds it. The PRE caller gates this to the
 * single-account case so a captured body is never mis-attributed across
 * multiple accounts.
 *
 * <p>Body source: prefers the SCRAPE.post-carried snapshot
 * ({@link IScrapeState.balanceResponseBodies}) — which survives onto the
 * scrape slice after the live mediator/pool is gone at BALANCE-RESOLVE.pre
 * — and falls back to the live mediator pool when the carried snapshot is
 * absent (preserves the pre-existing unit-test contract).
 */

import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { IDiscoveredEndpoint } from '../Network/Types/Endpoint.js';
import { runBalanceExtractor } from './BalanceExtractor.js';
import { BULK_KEY } from './BalanceFetchPlanner.js';

/** Empty captured-response sentinel — exported so callers branch-free. */
const EMPTY_CAPTURED: ReadonlyMap<string, unknown> = new Map();

/** Empty body-pool sentinel for absent-state paths. */
const EMPTY_BODIES: readonly unknown[] = [];

/**
 * Does this captured response body carry a resolvable balance?
 * @param body - Captured endpoint response body.
 * @returns True when {@link runBalanceExtractor} finds a finite balance.
 */
function hasBalance(body: unknown): boolean {
  return runBalanceExtractor(body) !== false;
}

/**
 * Pick the first response body that carries a balance.
 * @param bodies - Captured response bodies.
 * @returns The balance-bearing body, or undefined when none match.
 */
function firstBalanceBody(bodies: readonly unknown[]): unknown {
  return bodies.find((body): boolean => hasBalance(body));
}

/**
 * Read the SCRAPE.post-carried response-body snapshot (mediator-independent,
 * survives into BALANCE-RESOLVE.pre). Empty when no snapshot was stamped.
 * @param input - Pipeline context (PRE).
 * @returns Carried bodies, or the empty sentinel.
 */
function readCarriedSnapshot(input: IPipelineContext): readonly unknown[] {
  if (!input.scrape.has) return EMPTY_BODIES;
  return input.scrape.value.balanceResponseBodies ?? EMPTY_BODIES;
}

/**
 * Read the live mediator network pool's response bodies. The pool is
 * cumulative across phases (the mediator is created once at INIT), so it
 * still holds the dashboard-phase balance response at BALANCE-RESOLVE.pre.
 * Empty when the mediator is absent.
 * @param input - Pipeline context (PRE).
 * @returns Mediator-pool bodies, or the empty sentinel.
 */
function readMediatorBodies(input: IPipelineContext): readonly unknown[] {
  if (!input.mediator.has) return EMPTY_BODIES;
  return input.mediator.value.network.getAllEndpoints().map((ep): unknown => ep.responseBody);
}

/**
 * Read the captured response bodies for the balance seed. Prefers the
 * SCRAPE.post-carried snapshot, but RESCUES from the live cumulative mediator
 * pool when the carried snapshot carries NO balance (the folded balance was
 * captured in an earlier phase and did not survive into the snapshot).
 * Strictly additive — it can only find MORE balance bodies, never fewer.
 * @param input - Pipeline context (PRE).
 * @returns Captured response bodies (possibly empty).
 */
function readPoolBodies(input: IPipelineContext): readonly unknown[] {
  const carried = readCarriedSnapshot(input);
  if (firstBalanceBody(carried) !== undefined) return carried;
  const live = readMediatorBodies(input);
  if (firstBalanceBody(live) !== undefined) return live;
  return carried.length > 0 ? carried : live;
}

/**
 * Build the single-entry captured-response map from response bodies. Pure
 * — unit-testable without a mediator.
 * @param bodies - Captured response bodies.
 * @returns Map keyed by {@link BULK_KEY}, or the empty sentinel.
 */
function buildCapturedFromBodies(bodies: readonly unknown[]): ReadonlyMap<string, unknown> {
  const body = firstBalanceBody(bodies);
  if (body === undefined) return EMPTY_CAPTURED;
  return new Map<string, unknown>([[BULK_KEY, body]]);
}

/**
 * Build the single-entry captured-response map from an endpoint pool.
 * Thin adapter over {@link buildCapturedFromBodies} retained for the
 * pure-pool unit tests.
 * @param pool - Captured endpoints.
 * @returns Map keyed by {@link BULK_KEY}, or the empty sentinel.
 */
function buildCapturedFromPool(pool: readonly IDiscoveredEndpoint[]): ReadonlyMap<string, unknown> {
  const bodies = pool.map((ep): unknown => ep.responseBody);
  return buildCapturedFromBodies(bodies);
}

/**
 * Read a balance-bearing response from the captured pool (carried snapshot
 * preferred, live mediator pool as fallback).
 * @param input - Pipeline context (PRE).
 * @returns Single-entry map keyed by {@link BULK_KEY}, or empty (default-deny).
 */
function readCapturedBalanceResponses(input: IPipelineContext): ReadonlyMap<string, unknown> {
  const bodies = readPoolBodies(input);
  return buildCapturedFromBodies(bodies);
}

/** PII-safe seed-source forensics emitted at BALANCE-RESOLVE.pre. */
interface ISeedForensics {
  readonly mediatorPresent: boolean;
  readonly carriedBalanceCount: number;
  readonly poolLen: number;
  readonly poolBalanceCount: number;
}

/**
 * Count response bodies that carry a resolvable balance.
 * @param bodies - Response bodies.
 * @returns Balance-bearing count.
 */
function countBalanceBodies(bodies: readonly unknown[]): number {
  return bodies.filter((body): boolean => hasBalance(body)).length;
}

/**
 * Build PII-safe seed forensics (counts/booleans only — never balance values,
 * account numbers, or URLs) so a live BALANCE-RESOLVE miss is root-causable
 * from the structured log without another blind run.
 * @param input - Pipeline context (PRE).
 * @returns Seed-source forensics bag.
 */
function diagnoseSeed(input: IPipelineContext): ISeedForensics {
  const carried = readCarriedSnapshot(input);
  const live = readMediatorBodies(input);
  return {
    mediatorPresent: input.mediator.has,
    carriedBalanceCount: countBalanceBodies(carried),
    poolLen: live.length,
    poolBalanceCount: countBalanceBodies(live),
  };
}

/**
 * Should PRE suppress a live balance re-fetch for this bank? True unless the
 * bank is declared a real account-balance bank (`config.balanceKind ===
 * 'account'`). Card companies (`'card-cycle'`) and not-yet-declared banks
 * (absent) are a deterministic no-op — they expose no account balance, so a
 * live re-fetch could only ever universal-miss. This per-bank declaration
 * replaces the earlier pool-shape inference: it cannot misread a credit-card
 * billing aggregate (e.g. `totalDebit`) as an account balance, which is what
 * drove the multi-account card-bank universal-miss regression.
 * @param input - Pipeline context (PRE).
 * @returns True when the bank has no declared account balance.
 */
function poolDisprovesBalance(input: IPipelineContext): boolean {
  return input.config.balanceKind !== 'account';
}

export {
  buildCapturedFromPool,
  diagnoseSeed,
  EMPTY_CAPTURED,
  hasBalance,
  poolDisprovesBalance,
  readCapturedBalanceResponses,
};

export type { ISeedForensics };
