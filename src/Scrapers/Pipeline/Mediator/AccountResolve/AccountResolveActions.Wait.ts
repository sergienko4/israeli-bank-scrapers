/**
 * AccountResolveActions.Wait — PRE/ACTION orchestrators + the
 * `awaitAndLog` race/telemetry helpers. Extracted from the
 * AccountResolveActions barrel so the per-file LoC cap is honoured
 * (phase-2e-residue).
 *
 * <p>PRE is passive-first: it waits for an id-bearing capture, and only
 * when none arrives does it actively nudge a same-URL SPA to its cards
 * view (clicking the well-known transactions link) so a navigation-gated
 * accounts API such as Isracard `GetCardList` fires, then re-resolves.
 */

import type { SelectorCandidate } from '../../../Base/Config/LoginConfig.js';
import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { WK_DASHBOARD } from '../../Registry/WK/DashboardWK.js';
import type { IActionContext, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';
import type { IDiscoveredEndpoint } from '../Network/NetworkDiscoveryTypes.js';
import { ACCOUNT_RESOLVE_BUDGET_MS } from '../Timing/TimingConfig.js';
import { discoverAccountsInPool } from './AccountFromPool.js';

/** Click timeout (ms) for the cards-view nudge — link is already visible post-login. */
const NUDGE_CLICK_TIMEOUT_MS = 5000;

/** Outcome label lookup for the wait result. */
const WAIT_OUTCOME: Record<'true' | 'false', 'matched' | 'timeout'> = {
  true: 'matched',
  false: 'timeout',
};

/** Diagnostic fields for the post-wait `awaitAndLog` debug payload. */
interface IAwaitDiagnostic {
  readonly message: string;
  readonly elapsedMs: string;
  readonly poolSize: string;
}

/** Bundled args for the `awaitAndLog` race. */
interface IAwaitArgs {
  readonly mediator: IElementMediator;
  readonly log: IPipelineContext['logger'];
}

/** Bundled args for the diagnostic builder. */
interface IAwaitDiagArgs {
  readonly outcomeKey: 'true' | 'false';
  readonly start: number;
  readonly poolSize: number;
}

/**
 * Caller-owned shape predicate for `INetworkDiscovery.waitForFirstId`.
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
 * Materialise the structured diagnostic logged by {@link awaitAndLog}.
 * @param args - Bundled outcome key + start time + pool size.
 * @returns Debug log payload shape consumed by `log.debug`.
 */
function buildAwaitDiagnostic(args: IAwaitDiagArgs): IAwaitDiagnostic {
  return {
    message: `account-resolve.pre wait → ${WAIT_OUTCOME[args.outcomeKey]}`,
    elapsedMs: String(Date.now() - args.start),
    poolSize: String(args.poolSize),
  };
}

/**
 * Compute the matched-key sentinel from the final pool snapshot.
 * @param pool - Final pre-nav capture pool after the race resolved.
 * @returns Stringified boolean keyed for {@link WAIT_OUTCOME}.
 */
function evaluateAwaitOutcome(pool: readonly IDiscoveredEndpoint[]): 'true' | 'false' {
  const matched = findFirstIdInPool(pool);
  return String(matched !== false) as 'true' | 'false';
}

/**
 * Build the structured diagnostic and emit it through the pipeline logger.
 * @param log - Pipeline logger sink.
 * @param pool - Final pre-nav capture pool.
 * @param start - Wall-clock start time in ms.
 * @returns Always true (sentinel for the chained call site).
 */
function logAwaitOutcome(
  log: IPipelineContext['logger'],
  pool: readonly IDiscoveredEndpoint[],
  start: number,
): true {
  const outcomeKey = evaluateAwaitOutcome(pool);
  const diagnostic = buildAwaitDiagnostic({ outcomeKey, start, poolSize: pool.length });
  log.debug(diagnostic);
  return true;
}

/**
 * Race the id-bearing capture watcher against the page's natural
 * `networkidle` signal — whichever resolves first wins.
 * @param args - Bundled mediator + logger.
 * @returns True after telemetry is emitted.
 */
async function awaitAndLog(args: IAwaitArgs): Promise<true> {
  const start = Date.now();
  const { network } = args.mediator;
  const idMatch = network.waitForFirstId(ACCOUNT_RESOLVE_BUDGET_MS, findFirstIdInPool);
  await args.mediator.raceWithNetworkIdle(idMatch, ACCOUNT_RESOLVE_BUDGET_MS);
  const pool = network.getPreNavCaptures();
  logAwaitOutcome(args.log, pool, start);
  return true;
}

/**
 * Drive a same-URL SPA to its cards/transactions view by clicking the
 * well-known transactions link, so an accounts API that only fires on
 * navigation (e.g. Isracard `GetCardList`) finally fires, then re-runs
 * the id-capture wait. The nudge click does NOT mark a dashboard click,
 * so its capture lands in `getPreNavCaptures()` for POST to read.
 * @param args - Bundled mediator + logger.
 * @returns Always true once the click + re-wait completed.
 */
async function nudgeCardsViewAndReWait(args: IAwaitArgs): Promise<true> {
  const candidates = WK_DASHBOARD.TRANSACTIONS as unknown as readonly SelectorCandidate[];
  args.log.debug({ message: 'account-resolve.pre nudge → click transactions link' });
  await args.mediator.resolveAndClick(candidates, NUDGE_CLICK_TIMEOUT_MS);
  await awaitAndLog(args);
  return true;
}

/**
 * Nudge the SPA only when the passive wait produced no id-bearing
 * capture. No-op for banks that already capture passively, so the
 * behaviour stays generic and additive (zero blast radius elsewhere).
 * @param args - Bundled mediator + logger.
 * @returns Always true (sentinel for the chained call site).
 */
async function nudgeIfNoId(args: IAwaitArgs): Promise<true> {
  const pool = args.mediator.network.getPreNavCaptures();
  if (findFirstIdInPool(pool) !== false) return true;
  return nudgeCardsViewAndReWait(args);
}

/**
 * Passive-first pool resolution: wait for an id-bearing capture, then
 * nudge the SPA only if none arrived. Keeps {@link executeAccountResolvePre}
 * under the per-function LoC cap.
 * @param args - Bundled mediator + logger.
 * @returns Always true once the wait (+ optional nudge) completed.
 */
async function resolvePoolWithNudge(args: IAwaitArgs): Promise<true> {
  await awaitAndLog(args);
  await nudgeIfNoId(args);
  return true;
}

/**
 * PRE — block on `waitForFirstId` so late-arriving auth-side id
 * captures make it into the pool before POST extracts.
 * @param input - Pipeline context.
 * @returns Updated context, or no-mediator fail.
 */
async function executeAccountResolvePre(
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'ACCOUNT-RESOLVE: no mediator');
  const mediator = input.mediator.value;
  const initialPool = mediator.network.getPreNavCaptures();
  input.logger.debug({ message: `account-resolve.pre pool=${String(initialPool.length)}` });
  await resolvePoolWithNudge({ mediator, log: input.logger });
  return succeed(input);
}

/**
 * ACTION — no-op. The sealed action context has no `mediator` surface.
 * @param input - Sealed action context.
 * @returns Pass-through success.
 */
function executeAccountResolveAction(input: IActionContext): Promise<Procedure<IActionContext>> {
  const passThrough = succeed(input);
  return Promise.resolve(passThrough);
}

export { executeAccountResolveAction, executeAccountResolvePre };
