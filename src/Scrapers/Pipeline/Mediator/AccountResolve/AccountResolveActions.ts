/**
 * ACCOUNT-RESOLVE phase Mediator — PRE/ACTION/POST/FINAL.
 * Phase orchestrates ONLY. All logic here.
 *
 * Strict contract: by the time this phase exits FINAL, every browser
 * bank's `ctx.accountDiscovery` MUST hold at least one id (or POST
 * fails the run loud with `ACCOUNT_RESOLUTION_FAILED`). The phase is
 * the single source-of-truth for "we know the user's accounts" — the
 * downstream DASHBOARD/SCRAPE phases consume the option without
 * re-running discovery.
 *
 * PURE GENERIC: works for every bank via the existing 3-source
 * predicate (`discoverAccountsInPool` — response container, GET URL
 * query, POST body). No per-bank branches anywhere in this file.
 *
 * PRE:    blocks on `network.waitForFirstId(20s)` so id-bearing
 *         captures landing late in auth still get into the pool;
 *         emits pool-size telemetry. Full mediator access.
 * ACTION: no-op (sealed action context — no `mediator`). Required
 *         override for the BasePhase template; the real work runs
 *         in PRE/POST where the network surface is reachable.
 * POST:   commits `ctx.accountDiscovery` from the pre-nav pool;
 *         fails loud when ids stay empty.
 * FINAL:  emits resolution telemetry; idempotent.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { some } from '../../Types/Option.js';
import type { IActionContext, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';
import type { IDiscoveredEndpoint } from '../Network/NetworkDiscoveryTypes.js';
import { ACCOUNT_RESOLVE_BUDGET_MS } from '../Timing/TimingConfig.js';
import { discoverAccountsInPool, poolMaxContainer } from './AccountFromPool.js';

/**
 * True when MOCK_MODE is active — lets ACCOUNT-RESOLVE skip its
 * fail-loud checks for the offline snapshot suite, which has no
 * captured network traffic and therefore cannot satisfy the
 * "every bank publishes ids" invariant. Mirrors the
 * `isMockModeOtpActive` valve in OtpFillPhaseActions.
 */
const isMockModeAccountResolveActive =
  process.env.MOCK_MODE === '1' || process.env.MOCK_MODE === 'true';

/** Outcome label lookup for the wait result (no ternary per project rules). */
const WAIT_OUTCOME: Record<'true' | 'false', 'matched' | 'timeout'> = {
  true: 'matched',
  false: 'timeout',
};

/**
 * Caller-owned shape predicate for {@link INetworkDiscovery.waitForFirstId}.
 * Wraps {@link discoverAccountsInPool} into the
 * `(pool) => endpoint | false` shape the network primitive consumes.
 *
 * <p>This indirection is the dependency-inversion seam: ACCOUNT-RESOLVE
 * owns the shape detector; Network owns the polling primitive.
 * Network has zero AccountResolve imports.
 *
 * @param pool - Captured endpoints from the pre-nav pool.
 * @returns First id-bearing endpoint or false.
 */
function findFirstIdInPool(pool: readonly IDiscoveredEndpoint[]): IDiscoveredEndpoint | false {
  if (pool.length === 0) return false;
  const result = discoverAccountsInPool(pool);
  if (result.endpoint === false) return false;
  if (result.ids.length === 0) return false;
  return result.endpoint;
}

/**
 * Block on `network.waitForFirstId` and emit telemetry for the
 * outcome. Pulled out of `executeAccountResolvePre` so that handler
 * stays inside the per-function line budget.
 *
 * @param mediator - Element mediator (network surface owner).
 * @param log - Pipeline logger.
 * @returns True after telemetry is emitted.
 */
async function awaitAndLog(
  mediator: IElementMediator,
  log: IPipelineContext['logger'],
): Promise<true> {
  const waitPromise = mediator.network.waitForFirstId(ACCOUNT_RESOLVE_BUDGET_MS, findFirstIdInPool);
  const matched = await waitPromise.catch((): false => false);
  const matchedKey = String(matched !== false) as 'true' | 'false';
  const outcome = WAIT_OUTCOME[matchedKey];
  log.debug({ message: `account-resolve.pre wait → ${outcome}` });
  return true;
}

/**
 * PRE — block on `waitForFirstId` so late-arriving auth-side id
 * captures (Hapoalim's `?accountId=` GETs) make it into the pool
 * before POST extracts. Fails fast when mediator absent.
 * @param input - Pipeline context.
 * @returns Updated context, or no-mediator fail.
 */
async function executeAccountResolvePre(
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.mediator.has) {
    return fail(ScraperErrorTypes.Generic, 'ACCOUNT-RESOLVE: no mediator');
  }
  const mediator = input.mediator.value;
  const initialPool = mediator.network.getPreNavCaptures();
  input.logger.debug({
    message: `account-resolve.pre pool=${String(initialPool.length)}`,
  });
  await awaitAndLog(mediator, input.logger);
  return succeed(input);
}

/**
 * ACTION — no-op. The sealed action context has no `mediator`
 * surface, so the real work (wait + extract + commit) runs in PRE
 * and POST. Required override for the BasePhase template.
 * @param input - Sealed action context.
 * @returns Pass-through success.
 */
function executeAccountResolveAction(input: IActionContext): Promise<Procedure<IActionContext>> {
  const passThrough = succeed(input);
  return Promise.resolve(passThrough);
}

/**
 * Builds the `ACCOUNT_RESOLUTION_FAILED` failure for the
 * empty-pool branch. Pulled out so the POST handler stays linear and
 * within the project's per-function line budget.
 * @param poolSize - Pre-nav capture count for the diagnostic message.
 * @returns Failure procedure with the fail-loud message.
 */
function failAccountResolutionFailed(poolSize: number): Procedure<IPipelineContext> {
  const msg =
    'ACCOUNT-RESOLVE POST: ACCOUNT_RESOLUTION_FAILED — ' +
    `pool=${String(poolSize)} captures, no id-bearing`;
  return fail(ScraperErrorTypes.Generic, msg);
}

/** Three-way comparison sentinel returned by {@link compareLocale}. */
type CompareSign = -1 | 0 | 1;

/**
 * Locale-aware comparator wrapping `String.localeCompare`. Sonar S2871
 * requires sorts on strings to use an explicit locale-aware comparator;
 * Rule #15 forbids primitive number returns from Pipeline functions, so
 * the result is narrowed to a {@link CompareSign} sentinel via
 * `Math.sign` — single expression, no branch coverage cost.
 *
 * @param a - First string.
 * @param b - Second string.
 * @returns -1 when a < b, 0 when equal, 1 when a > b.
 */
function compareLocale(a: string, b: string): CompareSign {
  const cmp = a.localeCompare(b);
  return Math.sign(cmp) as CompareSign;
}

/**
 * Render a per-container count map as a stable diagnostic string.
 * Used by {@link failAccountResolutionIncomplete} so the F2 error
 * message lists every WK container the picker found AND its size,
 * letting the operator see exactly which container the extractor
 * dropped. Carries only WK constant names + integer counts — no
 * record fields, no ids — so PII can never leak through the message.
 * @param containers - Per-WK-name container split from the picked
 *   endpoint's body.
 * @returns Sorted `name:count` joined with `,`, or `none`.
 */
function renderContainerCounts(
  containers: Readonly<Record<string, readonly Record<string, unknown>[]>>,
): string {
  const names = Object.keys(containers).sort(compareLocale);
  if (names.length === 0) return 'none';
  return names.map((name): string => `${name}:${String(containers[name].length)}`).join(',');
}

/**
 * Builds the `ACCOUNT_RESOLUTION_INCOMPLETE` failure when the
 * picker returned fewer ids than the SUM of every WK container in
 * the picked endpoint's body — proves the bank served more accounts
 * than the extractor surfaced. Halts the run BEFORE DASHBOARD
 * instead of silently scraping a partial list.
 *
 * <p>Phase 7d tightening: the `expected` count is now the SUM
 * across all WK containers in the picked body (not the legacy
 * single-container max), so VisaCal's `cards: [4]` + `bankAccounts:
 * [3]` payload demands 7 ids, not 4.
 *
 * @param resolved - Resolved id count.
 * @param expected - Sum-of-WK-containers across the pool.
 * @param containers - Per-WK-name split for diagnostic detail.
 * @returns Failure procedure with the fail-loud message.
 */
function failAccountResolutionIncomplete(
  resolved: number,
  expected: number,
  containers: Readonly<Record<string, readonly Record<string, unknown>[]>>,
): Procedure<IPipelineContext> {
  const detail = renderContainerCounts(containers);
  const msg =
    'ACCOUNT-RESOLVE POST: ACCOUNT_RESOLUTION_INCOMPLETE — ' +
    `resolved=${String(resolved)}, expected=${String(expected)}, containers={${detail}}`;
  return fail(ScraperErrorTypes.Generic, msg);
}

/**
 * Surface the captureIndex of the picker's chosen endpoint, with
 * `0` as the sentinel when no endpoint was picked (root-array
 * fallback or request-side path). Lookup-style replacement for the
 * inline ternary banned by the project's no-restricted-syntax rule.
 * @param endpoint - Picker output (endpoint or false).
 * @returns Capture index, or 0 sentinel.
 */
function resolveCaptureIndex(
  endpoint: ReturnType<typeof discoverAccountsInPool>['endpoint'],
): number {
  if (endpoint === false) return 0;
  return endpoint.captureIndex ?? 0;
}

/**
 * POST — extracts ids from the pre-nav pool, commits
 * `ctx.accountDiscovery`, or fails loud when the resolution is
 * empty or partial.
 *
 * <p>Two failure modes guard the contract that ACCOUNT-RESOLVE is
 * the single source of truth for account info:
 * <ul>
 *   <li>`ACCOUNT_RESOLUTION_FAILED` — no capture surfaced any
 *   id (empty pool or unrecognized shape).</li>
 *   <li>`ACCOUNT_RESOLUTION_INCOMPLETE` — picker returned
 *   fewer ids than another capture clearly carried, evidence that
 *   the bank served more accounts than the extractor surfaced.</li>
 * </ul>
 *
 * @param input - Pipeline context.
 * @returns Updated context with the discovery option populated, or
 *   one of the two fail-loud procedures.
 */
function executeAccountResolvePost(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  if (!input.mediator.has) {
    const passThrough = succeed(input);
    return Promise.resolve(passThrough);
  }
  // MOCK_MODE safety valve — the offline snapshot suite has no captured
  // network traffic, so the fail-loud checks can't apply. Live E2E is
  // the only environment where the contract is enforceable.
  if (isMockModeAccountResolveActive) {
    const passThrough = succeed(input);
    return Promise.resolve(passThrough);
  }
  const mediator = input.mediator.value;
  const pool = mediator.network.getPreNavCaptures();
  const result = discoverAccountsInPool(pool);
  if (result.ids.length === 0) {
    const failure = failAccountResolutionFailed(pool.length);
    return Promise.resolve(failure);
  }
  const expected = poolMaxContainer(pool);
  if (result.ids.length < expected) {
    const failure = failAccountResolutionIncomplete(result.ids.length, expected, result.containers);
    return Promise.resolve(failure);
  }
  const captureIndex = resolveCaptureIndex(result.endpoint);
  const accountDiscovery = some({
    ids: result.ids,
    records: result.records,
    containers: result.containers,
    endpointCaptureIndex: captureIndex,
  });
  const success = succeed({ ...input, accountDiscovery });
  return Promise.resolve(success);
}

/** First-id label lookup — no `''` fallbacks per project rules. */
const FIRST_ID_LABEL: Record<'true' | 'false', (ids: readonly string[]) => string> = {
  /**
   * Non-empty case — return the head id.
   * @param ids - Resolved id list.
   * @returns First id.
   */
  true: (ids): string => ids[0],
  /**
   * Empty case — sentinel string for telemetry parity.
   * @returns Sentinel.
   */
  false: (): string => 'none',
};

/**
 * Surface the resolved id list from the discovery option, returning
 * an empty array when the option is `none`. Lookup-style replacement
 * for the inline ternary.
 * @param ctx - Pipeline context.
 * @returns Resolved id list (possibly empty).
 */
function resolvedIds(ctx: IPipelineContext): readonly string[] {
  const has = ctx.accountDiscovery.has;
  if (!has) return [];
  return ctx.accountDiscovery.value.ids;
}

/**
 * FINAL — resolution telemetry. Idempotent: re-running this stage
 * with the same context produces the same log line.
 * @param input - Pipeline context.
 * @returns Pass-through success.
 */
function executeAccountResolveFinal(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  const ids = resolvedIds(input);
  const labelKey = String(ids.length > 0) as 'true' | 'false';
  const firstId = FIRST_ID_LABEL[labelKey](ids);
  input.logger.debug({
    message: `account-resolve.final ids=${String(ids.length)} firstId=${firstId}`,
  });
  const success = succeed(input);
  return Promise.resolve(success);
}

export { ACCOUNT_RESOLVE_BUDGET_MS } from '../Timing/TimingConfig.js';
export {
  executeAccountResolveAction,
  executeAccountResolveFinal,
  executeAccountResolvePost,
  executeAccountResolvePre,
};
