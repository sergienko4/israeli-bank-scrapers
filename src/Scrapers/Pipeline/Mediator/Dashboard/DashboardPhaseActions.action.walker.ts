/**
 * Identity-then-fallback click walker for DASHBOARD ACTION.
 *
 * <p>Co-located sibling of {@link "./DashboardPhaseActions.js"}. Split
 * out so the parent ACTION file stays under the LoC cap. The walker
 * dispatches the STAGE-1 identity click first; on miss, iterates
 * `.nth(0..count-1)` of the generic-fallback selector with a goback
 * between attempts.
 */

import { WK_DASHBOARD } from '../../Registry/WK/DashboardWK.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import type { IActionContext, IResolvedTarget } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';
import type { IActionMediator } from '../Elements/ElementMediator.js';
import { DASHBOARD_POST_MATCH_TXN_WAIT_MS } from '../Timing/TimingConfig.js';

/** Bundled args for the two-stage walker — fits 3-param ceiling. */
interface IIterateArgs {
  readonly executor: IActionMediator;
  readonly target: IResolvedTarget;
  readonly fallbackSelector: string;
  readonly count: number;
  readonly input: IActionContext;
}

/** Bundled args for a single click attempt evaluation. */
interface IClickAttemptArgs {
  readonly executor: IActionMediator;
  readonly contextId: IResolvedTarget['contextId'];
  readonly selector: string;
  readonly nth?: number;
  readonly attemptLabel: string;
  readonly input: IActionContext;
}

/** Outcome of a single click attempt — success bit + URL before/after. */
interface IClickOutcome {
  readonly isSuccess: boolean;
  readonly urlBefore: string;
  readonly urlAfter: string;
}

/** Force-click flag for candidate clicks (matches existing menu/legacy pattern). */
const shouldForceCandidateClick = true;

/**
 * URL-pattern signal — universal post-click "did we land on the txn page?".
 * @param url - Current URL after click.
 * @returns True iff URL matches any known transactions-page pattern.
 */
function isTxnPageUrl(url: string): boolean {
  return WK_DASHBOARD.TXN_PAGE_PATTERNS.some((pat): boolean => pat.test(url));
}

/**
 * Confirm a WK transactions endpoint is captured after a URL-pattern match.
 * @param executor - Sealed action mediator.
 * @param isOnTxnPage - Whether the post-click URL matched the WK patterns.
 * @returns True iff a txn-shape endpoint is captured by budget end.
 */
async function confirmTxnEndpoint(
  executor: IActionMediator,
  isOnTxnPage: boolean,
): Promise<boolean> {
  if (isOnTxnPage) {
    return executor.waitForTxnEndpoint(DASHBOARD_POST_MATCH_TXN_WAIT_MS).catch((): false => false);
  }
  return executor.hasTxnEndpoint();
}

/**
 * Emit the "starting CLICK" log line.
 * @param input - Action context for logger access.
 * @param args - Bundled click attempt arguments.
 * @returns Always true so the caller stays expression-shaped.
 */
function logClickStart(input: IActionContext, args: IClickAttemptArgs): true {
  input.logger.debug({
    strategy: 'CLICK',
    attempt: args.attemptLabel,
    result: `${args.contextId} > ${maskVisibleText(args.selector)}`,
  });
  return true;
}

/**
 * Best-effort click + settle for {@link evaluateClickAttempt}.
 * @param args - Bundled click attempt arguments.
 * @returns Always true once the click + settle attempt has resolved.
 */
async function dispatchClickAndSettle(args: IClickAttemptArgs): Promise<true> {
  const { executor, contextId, selector, nth } = args;
  await executor
    .clickElement({ contextId, selector, isForce: shouldForceCandidateClick, nth })
    .then((): true => true)
    .catch((): false => false);
  await executor.waitForNetworkIdle().catch((): false => false);
  return true;
}

/** Bundled signal-read result for {@link evaluateClickAttempt}. */
interface IClickSignal {
  readonly isHasTxn: boolean;
  readonly isOnTxnPage: boolean;
  readonly isSuccess: boolean;
  readonly urlAfter: string;
}

/**
 * Evaluate the post-click txn signal (BFF endpoint capture OR URL on a
 * known TXN_PAGE_PATTERN).
 * @param executor - Sealed action mediator.
 * @returns hasTxn + isOnTxnPage + success bit + post-click URL.
 */
async function readClickSignal(executor: IActionMediator): Promise<IClickSignal> {
  const urlAfter = executor.getCurrentUrl();
  const isOnTxnPage = isTxnPageUrl(urlAfter);
  const isHasTxn = await confirmTxnEndpoint(executor, isOnTxnPage);
  return { isHasTxn, isOnTxnPage, urlAfter, isSuccess: isHasTxn || isOnTxnPage };
}

/**
 * Emit the OK log line when {@link evaluateClickAttempt} sees a txn signal.
 * @param input - Action context for logger access.
 * @param attemptLabel - Identity/F-N attempt label.
 * @param signal - Post-click signal bundle with hasTxn + urlAfter.
 * @returns Always true so the caller stays expression-shaped.
 */
function logClickSuccess(input: IActionContext, attemptLabel: string, signal: IClickSignal): true {
  input.logger.debug({
    strategy: 'CLICK',
    attempt: attemptLabel,
    result: `OK — hasTxn=${String(signal.isHasTxn)} url=${signal.urlAfter}`,
  });
  return true;
}

/**
 * Execute a click + evaluate post-click txn signal.
 * @param args - Bundled click attempt arguments.
 * @returns Outcome with success bit and url state.
 */
async function evaluateClickAttempt(args: IClickAttemptArgs): Promise<IClickOutcome> {
  const urlBefore = args.executor.getCurrentUrl();
  logClickStart(args.input, args);
  await dispatchClickAndSettle(args);
  const signal = await readClickSignal(args.executor);
  if (signal.isSuccess) logClickSuccess(args.input, args.attemptLabel, signal);
  return { isSuccess: signal.isSuccess, urlBefore, urlAfter: signal.urlAfter };
}

/**
 * Run the goback navigation for {@link restoreUrlIfChanged}.
 * @param executor - Sealed action mediator.
 * @param urlBefore - Pre-click URL to navigate back to.
 * @returns Always true once the goback attempt settles.
 */
async function runGobackNavigation(executor: IActionMediator, urlBefore: string): Promise<true> {
  await executor.navigateTo(urlBefore, { waitUntil: 'load' }).catch((): false => false);
  await executor.waitForNetworkIdle().catch((): false => false);
  return true;
}

/**
 * Restore the page to the pre-click URL when a click navigated somewhere
 * other than the txn page.
 * @param executor - Sealed action mediator.
 * @param outcome - Click outcome with url before/after.
 * @param logger - Pipeline logger.
 * @returns True when a goback navigation was attempted.
 */
async function restoreUrlIfChanged(
  executor: IActionMediator,
  outcome: IClickOutcome,
  logger: IActionContext['logger'],
): Promise<boolean> {
  if (outcome.urlAfter === outcome.urlBefore) return false;
  logger.debug({ message: `goback: ${maskVisibleText(outcome.urlBefore)}` });
  return runGobackNavigation(executor, outcome.urlBefore);
}

/**
 * Run the STAGE-1 identity click for {@link runIdentityThenFallback}.
 * @param args - Bundled iteration arguments.
 * @returns Outcome of the identity click attempt.
 */
function runIdentityAttempt(args: IIterateArgs): Promise<IClickOutcome> {
  return evaluateClickAttempt({
    executor: args.executor,
    contextId: args.target.contextId,
    selector: args.target.selector,
    attemptLabel: 'identity',
    input: args.input,
  });
}

/**
 * Run one F-N attempt for {@link walkFallbackNth}.
 * @param args - Bundled iteration arguments.
 * @param i - Current 0-based nth index.
 * @returns Outcome of the click attempt at .nth(i).
 */
function runFallbackAttempt(args: IIterateArgs, i: number): Promise<IClickOutcome> {
  return evaluateClickAttempt({
    executor: args.executor,
    contextId: args.target.contextId,
    selector: args.fallbackSelector,
    nth: i,
    attemptLabel: `nth=${String(i)}`,
    input: args.input,
  });
}

/**
 * Iterate `.nth(0..count-1)` of the generic fallback selector when identity
 * click failed. Tail-recursive (no for-loop) to satisfy `no-await-in-loop`.
 * @param args - Bundled iteration arguments.
 * @param i - Current 0-based nth index.
 * @returns Procedure for the action context.
 */
async function walkFallbackNth(args: IIterateArgs, i: number): Promise<Procedure<IActionContext>> {
  if (i >= args.count) return succeed(args.input);
  const outcome = await runFallbackAttempt(args, i);
  if (outcome.isSuccess) return succeed(args.input);
  await restoreUrlIfChanged(args.executor, outcome, args.input.logger);
  return walkFallbackNth(args, i + 1);
}

/**
 * Two-stage walker entry: identity click first, then iterate fallback nth(0..count-1).
 * @param args - Bundled iteration arguments.
 * @returns Procedure once a click landed on a txn page or all options exhausted.
 */
async function runIdentityThenFallback(args: IIterateArgs): Promise<Procedure<IActionContext>> {
  const identityOutcome = await runIdentityAttempt(args);
  if (identityOutcome.isSuccess) return succeed(args.input);
  await restoreUrlIfChanged(args.executor, identityOutcome, args.input.logger);
  if (!args.fallbackSelector || args.count <= 1) return succeed(args.input);
  return walkFallbackNth(args, 0);
}

export type { IIterateArgs };
export default runIdentityThenFallback;
export { runIdentityThenFallback };
