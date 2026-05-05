/**
 * Popup guard — "Senses before Muscles" check for PopupInterceptor.
 * If a WK_HOME.ENTRY element is already visible, popup dismiss is skipped.
 */

import type { SelectorCandidate } from '../../Base/Config/LoginConfigTypes.js';
import type { IElementMediator } from '../Mediator/Elements/ElementMediator.js';
import { WK_HOME } from '../Registry/WK/HomeWK.js';

/** Quick probe timeout for entry visibility check. */
const ENTRY_PROBE_MS = 2000;

/** Whether a WK entry point is already visible on the page. */
type IsEntryVisible = boolean;

/**
 * Check if any WK_HOME.ENTRY element is already visible.
 * If yes, popup dismiss is not needed — the login button is accessible.
 * @param mediator - Element mediator.
 * @returns True if any entry text is visible.
 */
async function isEntryAlreadyVisible(mediator: IElementMediator): Promise<IsEntryVisible> {
  const candidates = WK_HOME.ENTRY as unknown as readonly SelectorCandidate[];
  const probeResult = await mediator
    .resolveVisible(candidates, ENTRY_PROBE_MS)
    .catch((): false => false);
  if (probeResult === false) return false;
  if (!probeResult.found) return false;
  return true;
}

export default isEntryAlreadyVisible;
export { isEntryAlreadyVisible };
