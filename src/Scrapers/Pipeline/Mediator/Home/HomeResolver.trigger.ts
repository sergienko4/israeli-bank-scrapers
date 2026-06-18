/**
 * HOME trigger resolution — provider-agnostic, accessible-name first.
 *
 * Extracted from {@link "./HomeResolver.ts"} to stay within the Home
 * cluster's 150-line / 10-line-per-function caps.
 *
 * THE RULE (one path for every bank — no per-bank flags): enumerate ALL
 * visible WK_HOME.ENTRY matches and PREFER the one matched by a precise
 * accessible-name candidate (`kind: 'ariaLabel'`). That candidate resolves
 * via getByRole/getByLabel, so it matches ONLY the element whose accessible
 * name IS the login text — the genuine interactive login control — never a
 * text-bearing ancestor wrapper. Classification then keys off THAT control's
 * own href (see {@link "./HomeResolver.ts"} classifyStrategy).
 *
 * WHY enumerate instead of single-winner (the cross-bank HOME regression
 * proven offline against faithful, CSS-inlined fixtures):
 *  · Bank Leumi exposes the visible text "כניסה לחשבון" on THREE nodes — a
 *    hidden nav `<a href="#">` (0×0, inside a `display:none` menu), the real
 *    login button `<a class="enter_account" href=".../H/Login.html">`, and
 *    that anchor's inner `<span>`. A single-winner race lets the lower-
 *    priority `textContent` candidate walk up to `//div[.//text()=…]` and win
 *    on a no-href PAGE WRAPPER before the precise accessible-name candidate is
 *    considered → HOME classifies a no-href node and mis-navigates. Preferring
 *    the accessible-name match picks the real anchor → DIRECT.
 *  · Banks whose real login link is a JS-driven `href="#"` (Beinleumi, Max)
 *    carry absolute hrefs only on MARKETING links (a YouTube embed, a partner
 *    site). Those marketing links have a DIFFERENT accessible name, so the
 *    accessible-name preference never selects them — login stays on the bank's
 *    own toggle → MODAL/SEQUENTIAL, no marketing-link stranding.
 *
 * Fallback: when no candidate matched by accessible name is visible, return
 * the first visible match — identical to the pre-Leumi single-winner pick for
 * text-only banks (hapoalim/discount/isracard/max/visacal/amex), so their
 * behavior is unchanged.
 */

import type { SelectorCandidate } from '../../../Base/Config/LoginConfigTypes.js';
import { WK_HOME } from '../../Registry/WK/HomeWK.js';
import type { ScraperLogger } from '../../Types/Debug.js';
import type { IElementMediator, IRaceResult } from '../Elements/ElementMediator.js';
import { HOME_RESOLVER_ENTRY_TIMEOUT_MS } from '../Timing/TimingConfig.js';

/** Max visible trigger matches to enumerate before applying the preference. */
const TRIGGER_MATCH_CAP = 8;

/** WK_HOME.ENTRY widened to the resolver's candidate shape (cast once). */
const TRIGGER_CANDIDATES = WK_HOME.ENTRY as unknown as readonly SelectorCandidate[];

/**
 * True when the match was produced by a precise accessible-name candidate
 * (`kind: 'ariaLabel'`) — i.e. the element whose accessible name IS the login
 * text (the genuine interactive control), not a text-bearing ancestor wrapper.
 * @param result - One visible trigger match.
 * @returns Whether an accessible-name candidate produced the match.
 */
function isAccessibleNameMatch(result: IRaceResult): boolean {
  return result.candidate !== false && result.candidate.kind === 'ariaLabel';
}

/**
 * Prefer the visible match found by accessible name (the real login control);
 * otherwise fall back to the first visible match (text-only banks — identical
 * to the pre-Leumi single-winner pick).
 * @param results - Visible trigger matches in candidate/DOM order.
 * @returns The chosen race result, or false when none are visible.
 */
function pickByAccessibleName(results: readonly IRaceResult[]): false | IRaceResult {
  if (results.length === 0) return false;
  return results.find(isAccessibleNameMatch) ?? results[0];
}

/**
 * Build the `.catch()` handler for the resolveAllVisible race — logs the
 * rejection cause at debug level then coerces the rejection into an empty
 * list so the caller can branch without try/catch.
 * @param logger - Pipeline logger for reporting the swallowed error.
 * @returns A `.catch()` callback returning an empty result list.
 */
function buildRaceCatchHandler(logger: ScraperLogger): (error: unknown) => readonly IRaceResult[] {
  return (error: unknown): readonly IRaceResult[] => {
    logger.debug({ event: 'home.trigger.resolve.failed', error: String(error) });
    return [];
  };
}

/**
 * Race the WK_HOME.ENTRY candidates for up to {@link TRIGGER_MATCH_CAP}
 * visible matches. Isolated so {@link resolveHomeTrigger} stays within
 * the per-function line cap despite the wrapped multi-arg call.
 * @param mediator - Element mediator providing the visibility race.
 * @returns Visible trigger matches in candidate/DOM order (possibly empty).
 */
function raceVisibleTriggers(mediator: IElementMediator): Promise<readonly IRaceResult[]> {
  return mediator.resolveAllVisible(
    TRIGGER_CANDIDATES,
    HOME_RESOLVER_ENTRY_TIMEOUT_MS,
    TRIGGER_MATCH_CAP,
  );
}

/**
 * Resolve the HOME login trigger: enumerate the visible WK_HOME.ENTRY matches
 * and prefer the one matched by accessible name (see file header for the
 * cross-bank root cause this provider-agnostic rule fixes).
 * @param mediator - Element mediator providing the visibility race.
 * @param logger - Pipeline logger for reporting a swallowed error.
 * @returns Race result on success, `false` when nothing visible.
 */
async function resolveHomeTrigger(
  mediator: IElementMediator,
  logger: ScraperLogger,
): Promise<false | IRaceResult> {
  const onReject = buildRaceCatchHandler(logger);
  const results = await raceVisibleTriggers(mediator).catch(onReject);
  return pickByAccessibleName(results);
}

export { resolveHomeTrigger };
export default resolveHomeTrigger;
