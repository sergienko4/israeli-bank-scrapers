/**
 * HOME phase passive discovery — 100% read-only DOM scan.
 * Rule #20: No phase may mutate state unless its name is ACTION.
 *
 * Scans WK_HOME.ENTRY for a visible trigger element.
 * Detects DIRECT (has href) vs SEQUENTIAL (menu toggle, no href).
 * Returns IHomeDiscovery — the "How-To" without the "Do."
 */

import type { SelectorCandidate } from '../../../Base/Config/LoginConfigTypes.js';
import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { WK_HOME } from '../../Registry/WK/HomeWK.js';
import type { ScraperLogger } from '../../Types/Debug.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../Types/Procedure.js';
import type { IElementMediator, IRaceResult } from '../Elements/ElementMediator.js';

/** Navigation strategy for HOME.ACTION. */
type NavStrategy = 'DIRECT' | 'SEQUENTIAL';
/** Visible text of a trigger element. */
type TriggerText = string;

/** Timeout for initial entry search. */
const ENTRY_TIMEOUT = 15000;

/** Discovery result from HOME.PRE — instructions for ACTION. */
interface IHomeDiscovery {
  /** Navigation strategy: single click or menu toggle + child click. */
  readonly strategy: NavStrategy;
  /** Text of the trigger element found in WK_HOME.ENTRY. */
  readonly triggerText: TriggerText;
  /** Menu child candidates (WK_HOME.MENU) — only for SEQUENTIAL. */
  readonly menuCandidates: readonly SelectorCandidate[];
}

/**
 * Passive discovery — find login entry and detect navigation strategy.
 * Zero clicks. Zero DOM mutation. Only reads attributes.
 * @param mediator - Element mediator.
 * @param logger - Pipeline logger.
 * @returns Procedure with IHomeDiscovery.
 */
async function resolveHomeStrategy(
  mediator: IElementMediator,
  logger: ScraperLogger,
): Promise<Procedure<IHomeDiscovery>> {
  const candidates = WK_HOME.ENTRY as unknown as readonly SelectorCandidate[];
  const visible = await mediator
    .resolveVisible(candidates, ENTRY_TIMEOUT)
    .catch((): false => false);
  if (!visible || !visible.found) {
    return fail(ScraperErrorTypes.Generic, 'HOME PRE: no login nav link found');
  }
  const triggerText = visible.value;
  const masked = maskVisibleText(triggerText);
  logger.debug({ event: 'element-found', phase: 'home', text: masked });
  const hasHref = await detectHref(mediator, visible);
  if (hasHref) {
    const direct = buildDirect(triggerText);
    return succeed(direct);
  }
  logger.debug({ event: 'home-nav-sequence', trigger: masked, target: 'MENU (pending)' });
  const sequential = buildSequential(triggerText);
  return succeed(sequential);
}

/**
 * Check if the resolved element has an href attribute (passive).
 * @param mediator - Element mediator.
 * @param result - Resolved race result.
 * @returns True if href exists.
 */
async function detectHref(mediator: IElementMediator, result: IRaceResult): Promise<boolean> {
  const attrResult = await mediator.checkAttribute(result, 'href');
  if (!isOk(attrResult)) return false;
  return attrResult.value;
}

/**
 * Build DIRECT discovery — single click navigates.
 * @param triggerText - Trigger element text.
 * @returns IHomeDiscovery for DIRECT strategy.
 */
function buildDirect(triggerText: TriggerText): IHomeDiscovery {
  return { strategy: 'DIRECT', triggerText, menuCandidates: [] };
}

/**
 * Build SEQUENTIAL discovery — menu toggle + child click.
 * @param triggerText - Trigger element text.
 * @returns IHomeDiscovery for SEQUENTIAL strategy.
 */
function buildSequential(triggerText: TriggerText): IHomeDiscovery {
  const menu = WK_HOME.MENU as unknown as readonly SelectorCandidate[];
  return { strategy: 'SEQUENTIAL', triggerText, menuCandidates: menu };
}

export type { IHomeDiscovery };
export default resolveHomeStrategy;
export { resolveHomeStrategy };
