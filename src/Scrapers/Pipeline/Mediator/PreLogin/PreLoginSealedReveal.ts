/**
 * PRE-LOGIN sealed reveal dispatcher — drives `IActionContext`-only
 * reveal action (CLICK or NAVIGATE) from a pre-resolved target.
 *
 * <p>Phase 2d strict-cluster split: extracted from
 * {@link ./PreLoginPhaseActions.ts} so each function fits the 10-LoC
 * ceiling and the entry-point file stays under the 150-LoC file cap.
 */

import { maskVisibleText } from '../../Types/LogEvent.js';
import type {
  IActionContext,
  IPreLoginDiscovery,
  IResolvedTarget,
} from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';
import type { IActionMediator } from '../Elements/ElementMediator.js';

/** Settle window after a sealed CLICK fires (best-effort network idle). */
const SEALED_CLICK_SETTLE_MS = 5000;

/**
 * Click the resolved target then wait for the network to go idle.
 * Side-effect only — caller still returns the original Procedure.
 * @param executor - Pre-narrowed action mediator.
 * @param target - Pre-resolved target with contextId + selector.
 * @returns True after click + settle.
 */
async function clickAndSettle(executor: IActionMediator, target: IResolvedTarget): Promise<true> {
  await executor.clickElement({ contextId: target.contextId, selector: target.selector });
  await executor.waitForNetworkIdle(SEALED_CLICK_SETTLE_MS).catch((): false => false);
  return true;
}

/**
 * Execute a sealed CLICK on a resolved reveal target.
 * @param input - Sealed action context.
 * @param target - Pre-resolved target with contextId + selector.
 * @param executor - Pre-narrowed executor from caller's `.has` gate.
 * @returns Succeed with input after click + network settle.
 */
async function executeSealedClick(
  input: IActionContext,
  target: IResolvedTarget,
  executor: IActionMediator,
): Promise<Procedure<IActionContext>> {
  const msg = `sealed-reveal: CLICK → ${target.contextId} > ${target.selector}`;
  input.logger.debug({ message: msg });
  await clickAndSettle(executor, target);
  return succeed(input);
}

/**
 * Execute a sealed NAVIGATE reveal: navigate to the resolved URL via
 * the executor. The selector field carries the URL in the NAVIGATE
 * shape (see {@link IPreLoginDiscovery.revealTarget}).
 * @param input - Sealed action context.
 * @param target - Resolved navigation target (selector = URL).
 * @param executor - Pre-narrowed executor from caller's `.has` gate.
 * @returns Succeed wrapping the input context after navigation.
 */
async function executeSealedNavigate(
  input: IActionContext,
  target: IResolvedTarget,
  executor: IActionMediator,
): Promise<Procedure<IActionContext>> {
  const url = target.selector;
  input.logger.debug({ message: `sealed-reveal: NAVIGATE → ${maskVisibleText(url)}` });
  await executor.navigateTo(url);
  return succeed(input);
}

/** Per-action sealed dispatcher signature. */
type SealedDispatcher = (
  input: IActionContext,
  target: IResolvedTarget,
  executor: IActionMediator,
) => Promise<Procedure<IActionContext>>;

/** Closed map of reveal-action ⇒ sealed dispatcher (no if/else cascade). */
const SEALED_DISPATCHERS: Partial<Record<string, SealedDispatcher>> = {
  CLICK: executeSealedClick,
  NAVIGATE: executeSealedNavigate,
};

/**
 * Dispatch a sealed reveal action against the resolved target.
 * Lookup-table driven — no if/else cascade.
 * @param input - Sealed action context.
 * @param disc - Frozen PRE-LOGIN discovery payload.
 * @returns Succeed Procedure after dispatch, or `false` when no
 *   target/executor or the action key is not in the dispatcher map.
 */
async function dispatchSealedReveal(
  input: IActionContext,
  disc: IPreLoginDiscovery,
): Promise<Procedure<IActionContext> | false> {
  if (!disc.revealTarget || !input.executor.has) return false;
  const dispatcher = SEALED_DISPATCHERS[disc.revealAction];
  if (!dispatcher) return false;
  return dispatcher(input, disc.revealTarget, input.executor.value);
}

/**
 * Static log payload for early-exit sealed-reveal branches.
 *
 * NONE-branch history: prior wording (`form already visible`) falsely implied
 * the form had rendered, masking `target="_blank"` popup failures where the
 * scraper was stranded on the marketing tab. The POST gate is the real
 * authority that verifies the form — see PR #299 for root-cause analysis.
 */
const SEALED_REVEAL_EXIT_MSG: Partial<Record<string, string>> = {
  'no-discovery': 'sealed-reveal: no discovery',
  NONE: 'sealed-reveal: NONE — no reveal target discovered; POST gate will verify form',
};

/**
 * Emit the early-exit log for a sealed-reveal branch and pass the
 * action context through unchanged.
 * @param input - Sealed action context.
 * @param key - Lookup key into {@link SEALED_REVEAL_EXIT_MSG}.
 * @returns Pass-through success Procedure.
 */
function logExitAndPass(input: IActionContext, key: string): Procedure<IActionContext> {
  input.logger.debug({ message: SEALED_REVEAL_EXIT_MSG[key] });
  return succeed(input);
}

/**
 * Dispatch a CLICK/NAVIGATE sealed reveal, falling through to a
 * diagnostic "no target/executor" log when neither dispatch fires.
 * @param input - Sealed action context.
 * @param disc - Frozen PRE-LOGIN discovery payload.
 * @returns Success Procedure after dispatch (or pass-through with log).
 */
async function executeDispatchedReveal(
  input: IActionContext,
  disc: IPreLoginDiscovery,
): Promise<Procedure<IActionContext>> {
  const dispatched = await dispatchSealedReveal(input, disc);
  if (dispatched !== false) return dispatched;
  input.logger.debug({ message: `sealed-reveal: ${disc.revealAction} but no target/executor` });
  return succeed(input);
}

/**
 * ACTION (sealed): Fire reveal click using only IActionContext fields.
 * Reads revealAction + revealTarget from preLoginDiscovery.
 * @param input - Sealed action context.
 * @returns Succeed after click, or pass-through.
 */
async function executeFireRevealClicksSealed(
  input: IActionContext,
): Promise<Procedure<IActionContext>> {
  if (!input.preLoginDiscovery.has) return logExitAndPass(input, 'no-discovery');
  const disc = input.preLoginDiscovery.value;
  if (disc.revealAction === 'NONE') return logExitAndPass(input, 'NONE');
  return executeDispatchedReveal(input, disc);
}

export default executeFireRevealClicksSealed;
export { executeFireRevealClicksSealed };
