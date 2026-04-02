/**
 * PRE-LOGIN reveal probes — WK_PRELOGIN selector resolution via mediator.
 * Owns its own WK — never imports from HomeWK.
 * Each phase is a strict State Machine with its own WK.
 */

import type { SelectorCandidate } from '../../../Base/Config/LoginConfig.js';
import { WK_PRELOGIN } from '../../Registry/WK/PreLoginWK.js';
import type { RevealStatus } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';

/** Whether a DOM element count check matched (> 0). */
type ElementFound = boolean;
/** Raw DOM element count from Playwright locator.count(). */
type ElementCount = number;

/**
 * Check if any WK_PRELOGIN.REVEAL text candidate exists in the DOM.
 * @param mediator - Active mediator for element queries.
 * @returns Procedure with boolean detection result.
 */
async function isRevealAttached(mediator: IElementMediator): Promise<Procedure<boolean>> {
  const textCandidates = (WK_PRELOGIN.REVEAL as readonly SelectorCandidate[]).filter(
    (c): ElementFound => c.kind === 'textContent',
  );
  const countPromises = textCandidates.map(
    (c): Promise<ElementCount> => mediator.countByText(c.value),
  );
  const counts = await Promise.all(countPromises);
  const isAttached = counts.some((n): ElementFound => n > 0);
  return succeed(isAttached);
}

/**
 * Probe WK_PRELOGIN.REVEAL and return RevealStatus.
 * @param mediator - Active mediator.
 * @param timeout - Race timeout ms.
 * @returns READY | OBSCURED | NOT_FOUND.
 */
export async function probeRevealStatus(
  mediator: IElementMediator,
  timeout: number,
): Promise<RevealStatus> {
  const candidates = WK_PRELOGIN.REVEAL as unknown as readonly SelectorCandidate[];
  const visibleResult = await mediator
    .resolveVisible(candidates, timeout)
    .catch((): false => false);
  if (visibleResult && visibleResult.found) {
    const matchedText = visibleResult.value;
    const fallback = '?';
    const cand = visibleResult.candidate || undefined;
    const matchedKind = cand?.kind ?? fallback;
    const matchedVal = cand?.value ?? fallback;
    const tag = `kind=${matchedKind} text="${matchedVal}"`;
    process.stderr.write(`      [PROBE] REVEAL READY: ${tag} snapshot="${matchedText}"\n`);
    return 'READY';
  }
  const attachResult = await isRevealAttached(mediator);
  if (attachResult.success && attachResult.value) return 'OBSCURED';
  return 'NOT_FOUND';
}

export default probeRevealStatus;
