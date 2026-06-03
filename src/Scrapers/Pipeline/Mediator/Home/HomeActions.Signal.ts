/**
 * HomeActions.Signal — store-login-signal + form-ready helpers
 * extracted from the Phase 5 HomeActions sibling so the barrel stays
 * under the per-file LoC cap (phase-2e-residue).
 */

import type { SelectorCandidate } from '../../../Base/Config/LoginConfig.js';
import { WK_PRELOGIN } from '../../Registry/WK/PreLoginWK.js';
import type { ScraperLogger } from '../../Types/Debug.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';
import { HOME_FORM_READY_TIMEOUT_MS } from '../Timing/TimingConfig.js';

/**
 * Probe the FORM_GATE visibility race once and unwrap to a boolean.
 * Pulled out so {@link waitForFormReady} stays under the per-function LoC budget.
 * @param mediator - Element mediator.
 * @returns True iff the gate resolved to a visible element.
 */
async function probeFormGate(mediator: IElementMediator): Promise<boolean> {
  const gate = WK_PRELOGIN.FORM_GATE as unknown as readonly SelectorCandidate[];
  const result = await mediator
    .resolveVisible(gate, HOME_FORM_READY_TIMEOUT_MS)
    .catch((): false => false);
  return result !== false && result.found;
}

/**
 * Wait for login form to be ready in any frame (password field visible).
 * Generic: searches all contexts via mediator.resolveVisible.
 * @param mediator - Element mediator.
 * @param logger - Pipeline logger.
 * @returns True if form ready, false on timeout.
 */
async function waitForFormReady(
  mediator: IElementMediator,
  logger: ScraperLogger,
): Promise<boolean> {
  const isReady = await probeFormGate(mediator);
  logger.debug({ message: `form-ready: ${String(isReady)}` });
  return isReady;
}

/**
 * Compose updated diagnostics with the captured loginUrl and emit the
 * masked debug record. Extracted so {@link executeStoreLoginSignal} stays
 * under the per-function LoC budget.
 * @param input - Pipeline context.
 * @param loginUrl - URL captured at the moment FORM_GATE proved ready.
 * @param logger - Pipeline logger.
 * @returns Updated pipeline context with loginUrl in diagnostics.
 */
function emitLoginSignal(
  input: IPipelineContext,
  loginUrl: string,
  logger: ScraperLogger,
): IPipelineContext {
  const diag = { ...input.diagnostics, loginUrl };
  logger.debug({ url: maskVisibleText(loginUrl), didNavigate: true });
  return { ...input, diagnostics: diag };
}

/**
 * FINAL: Prove form ready + store loginUrl → signal to PRE-LOGIN.
 * Scans all frames for password field (FORM_GATE) before signaling.
 * @param mediator - Element mediator.
 * @param input - Pipeline context.
 * @param logger - Pipeline logger.
 * @returns Updated context with loginUrl in diagnostics.
 */
async function executeStoreLoginSignal(
  mediator: IElementMediator,
  input: IPipelineContext,
  logger: ScraperLogger,
): Promise<Procedure<IPipelineContext>> {
  const loginUrl = mediator.getCurrentUrl();
  await waitForFormReady(mediator, logger);
  const signaled = emitLoginSignal(input, loginUrl, logger);
  return succeed(signaled);
}

export { executeStoreLoginSignal, waitForFormReady };
