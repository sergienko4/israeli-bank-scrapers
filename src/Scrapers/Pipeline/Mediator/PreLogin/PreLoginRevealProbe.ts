/**
 * PRE-LOGIN reveal probes — WK_PRELOGIN selector resolution via mediator.
 * Owns its own WK — never imports from HomeWK.
 * Each phase is a strict State Machine with its own WK.
 */

import type { SelectorCandidate } from '../../../Base/Config/LoginConfig.js';
import { WK_PRELOGIN } from '../../Registry/WK/PreLoginWK.js';
import type { ScraperLogger } from '../../Types/Debug.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import type { RevealStatus } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';
import type { IElementMediator, IRaceResult } from '../Elements/ElementMediator.js';

/**
 * Check if any WK_PRELOGIN.REVEAL text candidate exists in the DOM.
 * @param mediator - Active mediator for element queries.
 * @returns Procedure with boolean detection result.
 */
async function isRevealAttached(mediator: IElementMediator): Promise<Procedure<boolean>> {
  const textCandidates = (WK_PRELOGIN.REVEAL as readonly SelectorCandidate[]).filter(
    (c): boolean => c.kind === 'textContent',
  );
  const countPromises = textCandidates.map((c): Promise<number> => mediator.countByText(c.value));
  const counts = await Promise.all(countPromises);
  const isAttached = counts.some((n): boolean => n > 0);
  return succeed(isAttached);
}

/**
 * Try to resolve a visible WK_PRELOGIN.REVEAL match. Wraps the
 * mediator call in a swallow-rejection guard so callers can fall
 * through to the attach probe without an outer try/catch.
 * @param mediator - Active mediator.
 * @param timeout - Race timeout ms.
 * @returns Race result on a visible hit, or false when none/rejected.
 */
async function tryResolveVisibleReveal(
  mediator: IElementMediator,
  timeout: number,
): Promise<IRaceResult | false> {
  const candidates = WK_PRELOGIN.REVEAL as unknown as readonly SelectorCandidate[];
  const result = await mediator.resolveVisible(candidates, timeout).catch((): false => false);
  if (result === false) return false;
  if (!result.found) return false;
  return result;
}

/**
 * Log a READY reveal-probe hit (masked) and return the constant
 * `'READY'` status so the caller stays inside the 10-LoC ceiling.
 * @param logger - Pipeline logger.
 * @param matchedText - Visible text the resolver matched.
 * @returns The `'READY'` reveal-status sentinel.
 */
function logReadyReveal(logger: ScraperLogger, matchedText: string): 'READY' {
  logger.debug({ text: maskVisibleText(matchedText), formGate: false });
  return 'READY';
}

/**
 * Fallback branch when {@link tryResolveVisibleReveal} returned no
 * visible hit — probe attach surface and translate into RevealStatus.
 * @param mediator - Active mediator.
 * @returns OBSCURED if attached but not visible, otherwise NOT_FOUND.
 */
async function probeAttachedFallback(mediator: IElementMediator): Promise<RevealStatus> {
  const attachResult = await isRevealAttached(mediator);
  if (attachResult.success && attachResult.value) return 'OBSCURED';
  return 'NOT_FOUND';
}

/**
 * Probe WK_PRELOGIN.REVEAL and return RevealStatus.
 * @param mediator - Active mediator.
 * @param timeout - Race timeout ms.
 * @param logger - Pipeline logger.
 * @returns READY | OBSCURED | NOT_FOUND.
 */
export async function probeRevealStatus(
  mediator: IElementMediator,
  timeout: number,
  logger: ScraperLogger,
): Promise<RevealStatus> {
  const visibleResult = await tryResolveVisibleReveal(mediator, timeout);
  if (visibleResult !== false) return logReadyReveal(logger, visibleResult.value);
  return probeAttachedFallback(mediator);
}

export default probeRevealStatus;
