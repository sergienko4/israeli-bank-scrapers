/**
 * HOME trigger resolution — prefer the real-href login link.
 *
 * Extracted from {@link "./HomeResolver.ts"} to stay within the Home
 * cluster's 150-line / 10-line-per-function caps.
 *
 * WHY this exists (Bank Leumi root-cause, proven by live-DOM probe):
 * the marketing home exposes the visible text "כניסה לחשבון" on THREE
 * nodes — a 0×0 hidden help `<a href="#">`, the real login button
 * `<a class="enter_account" href=".../H/Login.html">`, and that anchor's
 * inner `<span>`. A single-winner `resolveVisible` race returned the
 * bare `<span>` (matched by the textContent candidate); the span has no
 * href, so HOME classified it SEQUENTIAL (menu toggle) and navigated to
 * the site search results instead of the login page.
 *
 * FIX: enumerate the visible matches (resolveAllVisible) and PREFER the
 * one that exposes a real navigable href. Fake-href banks (MODAL /
 * SEQUENTIAL menu toggles, e.g. Visacal) have no real-href match and
 * fall back to the first visible result — identical to prior behaviour.
 */

import type { SelectorCandidate } from '../../../Base/Config/LoginConfigTypes.js';
import { WK_HOME } from '../../Registry/WK/HomeWK.js';
import type { ScraperLogger } from '../../Types/Debug.js';
import type { IElementMediator, IRaceResult } from '../Elements/ElementMediator.js';
import { HOME_RESOLVER_ENTRY_TIMEOUT_MS } from '../Timing/TimingConfig.js';

/** Max visible trigger matches to enumerate before preferring a real href. */
const TRIGGER_MATCH_CAP = 8;

/** WK_HOME.ENTRY widened to the resolver's candidate shape (cast once). */
const TRIGGER_CANDIDATES = WK_HOME.ENTRY as unknown as readonly SelectorCandidate[];

/** Element-identity sentinel emitted when an element has no href attribute. */
const NO_HREF_SENTINEL = '(none)';

/** Non-navigation href values — modal/menu toggles, SPA anchors, no href. */
const NON_NAV_HREFS: ReadonlySet<string> = new Set([
  NO_HREF_SENTINEL,
  '#',
  'javascript:void(0)',
  'javascript:;',
  '',
]);

/**
 * True when the race result resolved to an element exposing a real,
 * navigable href (e.g. Leumi's `<a class="enter_account">`) rather than
 * a bare text node, container, or menu toggle.
 * @param result - One visible trigger match from resolveAllVisible.
 * @returns Whether the match carries a real navigation href.
 */
function hasRealHref(result: IRaceResult): boolean {
  if (result.identity === false) return false;
  return !NON_NAV_HREFS.has(result.identity.href);
}

/**
 * Prefer the first visible match exposing a real href; otherwise fall
 * back to the first visible match (fake-href MODAL/SEQUENTIAL banks).
 * @param results - Visible trigger matches in DOM order.
 * @returns The chosen race result, or false when none are visible.
 */
function pickRealHrefOrFirst(results: readonly IRaceResult[]): false | IRaceResult {
  if (results.length === 0) return false;
  return results.find(hasRealHref) ?? results[0];
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
 * @returns Visible trigger matches in DOM order (possibly empty).
 */
function raceVisibleTriggers(mediator: IElementMediator): Promise<readonly IRaceResult[]> {
  return mediator.resolveAllVisible(
    TRIGGER_CANDIDATES,
    HOME_RESOLVER_ENTRY_TIMEOUT_MS,
    TRIGGER_MATCH_CAP,
  );
}

/**
 * Resolve the HOME login trigger, preferring a real-href link over an
 * ambiguous bare-text match (see file header for the Leumi root-cause).
 * @param mediator - Element mediator providing the visibility race.
 * @param logger - Pipeline logger for reporting a swallowed error.
 * @returns Race result on success, `false` when nothing visible.
 */
async function resolveHomeTrigger(
  mediator: IElementMediator,
  logger: ScraperLogger,
): Promise<false | IRaceResult> {
  const onReject = buildRaceCatchHandler(logger);
  const race = raceVisibleTriggers(mediator);
  const results = await race.catch(onReject);
  return pickRealHrefOrFirst(results);
}

export { resolveHomeTrigger };
export default resolveHomeTrigger;
