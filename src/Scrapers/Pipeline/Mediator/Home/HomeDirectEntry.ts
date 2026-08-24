/**
 * HOME entry-point preference — prefer a navigable DIRECT (real-href)
 * login link over an href-less SEQUENTIAL trigger.
 *
 * Root cause (Amex): the same Wix label `כניסה לחשבון שלי` renders as an
 * href-less `<button>` (classified SEQUENTIAL → click-in-place → broken
 * Wix JS → no navigation), while the real `<a href=…/personalarea/login/>`
 * anchor (`החשבון שלי`) ranks LOWER in WK_HOME.ENTRY, so the single-winner
 * `resolveVisible` never reaches it. When the primary winner is SEQUENTIAL,
 * re-scan all visible candidates and prefer the first DIRECT one.
 * Isracard's primary is already DIRECT → returned unchanged.
 *
 * <p>The scan spans WK_HOME.MENU as well as WK_HOME.ENTRY. A SEQUENTIAL
 * trigger is a menu toggle: its login link does not exist in the DOM until the
 * toggle has been clicked, so the first discovery sees only the toggle, clicks
 * it, and HOME's POST fails — which is what drives the sanitization pulse and a
 * second discovery. By then the menu is open, and the revealed link is a MENU
 * candidate. Max reaches `/login` exactly this way.
 *
 * <p>Selection prefers a real href, then an accessible name. Max's revealed
 * link is `<a id="private" class="login-link" aria-label="כניסה לאזור אישי -
 * לקוחות פרטיים">` — no href at all, so an href-only rule rejects it. Both
 * rules exclude the shape behind the pre-Phase-6 regression: that second click
 * re-resolved by raw `text=<value>` against an unscoped locator and could land
 * on a wrapper sharing the visible text. A walked-up wrapper carries neither a
 * navigable href nor an accessible name, so it stays unselectable.
 */

import type { SelectorCandidate } from '../../../Base/Config/LoginConfigTypes.js';
import { WK_HOME } from '../../Registry/WK/HomeWK.js';
import type { ScraperLogger } from '../../Types/Debug.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import type {
  IElementIdentity,
  IElementMediator,
  IRaceResult,
} from '../Elements/ElementMediator.js';
import { HOME_ENTRY_TIMEOUT_MS } from '../Timing/HomeTimingConfig.js';
import type { NavStrategy } from './HomeStrategyClassify.js';
import { classifyStrategy, NAV_STRATEGY } from './HomeStrategyClassify.js';

/** Placeholder the identity capture uses when an element carries no DOM id. */
const NO_DOM_ID = '(none)';

/** Bundled args for {@link preferDirectEntry} — keeps params ≤3. */
interface IPreferDirectArgs {
  readonly mediator: IElementMediator;
  readonly primary: IRaceResult;
  readonly logger: ScraperLogger;
}

/**
 * Login entry points plus the menu items a toggle reveals — the second group
 * only ever resolves once a SEQUENTIAL trigger has opened its menu.
 */
const ENTRY_AND_MENU = [
  ...WK_HOME.ENTRY,
  ...WK_HOME.MENU,
] as unknown as readonly SelectorCandidate[];

/**
 * Resolve every visible entry or revealed menu candidate in DOM order.
 *
 * <p>Uses the short re-find budget, not the pre-click discovery budget: the
 * primary trigger has already been resolved, so this only asks what is visible
 * *now*. A revealed menu item exists the moment its toggle is clicked and never
 * appears by waiting, so a long ceiling buys nothing and holds the homepage in
 * a 41-locator race — the same shape that got a CI-runner IP edge-blocked.
 *
 * @param mediator - Element mediator providing the visibility race.
 * @returns Up to one result per candidate, empty when none visible.
 */
async function resolveAllEntries(mediator: IElementMediator): Promise<readonly IRaceResult[]> {
  const cap = ENTRY_AND_MENU.length;
  return mediator.resolveAllVisible(ENTRY_AND_MENU, HOME_ENTRY_TIMEOUT_MS, cap);
}

/**
 * Find the first DIRECT-classified result among the resolved candidates.
 * @param mediator - Element mediator for passive classification.
 * @param all - Top-N visible candidates in DOM order.
 * @returns The first DIRECT result, or `false` when none qualify.
 */
async function firstDirect(
  mediator: IElementMediator,
  all: readonly IRaceResult[],
): Promise<false | IRaceResult> {
  const pending = all.map((r: IRaceResult): Promise<NavStrategy> => classifyStrategy(mediator, r));
  const strategies = await Promise.all(pending);
  const idx = strategies.indexOf(NAV_STRATEGY.DIRECT);
  return idx === -1 ? false : all[idx];
}

/** Candidate kind that resolves a control by its accessible name. */
const ACCESSIBLE_NAME_KIND = 'ariaLabel';

/**
 * Identity fields that still tell two controls apart once the DOM id is gone.
 * Ordered widest-to-narrowest only for readability — all are compared.
 */
const IDENTITY_KEYS = ['tag', 'name', 'ariaLabel', 'title', 'href'] as const;

/**
 * Whether the identity carries a DOM id worth comparing.
 * @param identity - Identity captured for a resolved element.
 * @returns True when the id is present and not the no-id placeholder.
 */
function hasUsableId(identity: IElementIdentity): boolean {
  return identity.id.length > 0 && identity.id !== NO_DOM_ID;
}

/**
 * The identity reduced to its stable attributes, joined on a separator that
 * cannot occur in an attribute value.
 * @param identity - Identity captured for a resolved element.
 * @returns Comparable fingerprint string.
 */
function identityFingerprint(identity: IElementIdentity): string {
  const parts = IDENTITY_KEYS.map((key: (typeof IDENTITY_KEYS)[number]): string => identity[key]);
  return parts.join('\u0000');
}

/**
 * True when both results resolved to the same DOM element.
 *
 * <p>Falls back to the stable attributes when either side has no usable id.
 * Treating an id-less pair as "different" defeated the whole guard: Max's
 * toggle is an `<a role="button">` that often carries no id, so the toggle
 * compared unequal to itself and was re-selected — clicking shut the menu it
 * had just opened.
 *
 * @param left - First result.
 * @param right - Second result.
 * @returns True when both describe the same control.
 */
function isSameElement(left: IRaceResult, right: IRaceResult): boolean {
  if (left.identity === false || right.identity === false) return false;
  if (hasUsableId(left.identity) && hasUsableId(right.identity)) {
    return left.identity.id === right.identity.id;
  }
  return identityFingerprint(left.identity) === identityFingerprint(right.identity);
}

/**
 * True when a result is an accessible-name match on some element other than
 * the primary.
 * @param result - Candidate result under test.
 * @param primary - The race winner being reconsidered.
 * @returns True when the result names a different control.
 */
function isOtherNamedControl(result: IRaceResult, primary: IRaceResult): boolean {
  if (result.candidate === false) return false;
  if (result.candidate.kind !== ACCESSIBLE_NAME_KIND) return false;
  return !isSameElement(result, primary);
}

/**
 * Find the first OTHER control a candidate matched by accessible name.
 *
 * <p>The primary is excluded deliberately. A menu toggle is typically
 * `<a role="button">` with no `aria-label`, so ARIA derives its accessible name
 * from its own text — which means an accessible-name candidate matches the
 * toggle as readily as the link it reveals, and the toggle comes first in DOM
 * order. Re-selecting it would click the menu shut again.
 *
 * <p>Unlike a text match, an accessible name belongs to the control itself, so
 * a walked-up wrapper never carries one.
 *
 * @param all - Top-N visible candidates in DOM order.
 * @param primary - The race winner being reconsidered.
 * @returns The first accessible-name match other than the primary, else `false`.
 */
function firstByAccessibleName(
  all: readonly IRaceResult[],
  primary: IRaceResult,
): false | IRaceResult {
  const hit = all.find((r: IRaceResult): boolean => isOtherNamedControl(r, primary));
  return hit ?? false;
}

/**
 * Announce the swapped entry point.
 * @param logger - Pipeline logger.
 * @param chosen - The result replacing the primary winner.
 * @returns The chosen result, unchanged.
 */
function logSwap(logger: ScraperLogger, chosen: IRaceResult): IRaceResult {
  logger.debug({ event: 'home.entry.prefer_direct', text: maskVisibleText(chosen.value) });
  return chosen;
}

/**
 * Prefer a navigable DIRECT entry when the primary race winner is an
 * href-less SEQUENTIAL trigger. Returns the primary unchanged for
 * DIRECT/MODAL winners (byte-identical for banks whose primary is
 * already navigable, e.g. Isracard) or when no better entry is
 * visible (preserves the SEQUENTIAL menu-toggle fallback).
 * @param args - Bundled mediator, primary race winner, logger.
 * @returns The preferred race result for classification + ACTION.
 */
async function preferDirectEntry(args: IPreferDirectArgs): Promise<IRaceResult> {
  const { mediator, primary, logger } = args;
  const strategy = await classifyStrategy(mediator, primary);
  if (strategy !== NAV_STRATEGY.SEQUENTIAL) return primary;
  const all = await resolveAllEntries(mediator);
  const direct = await firstDirect(mediator, all);
  if (direct !== false) return logSwap(logger, direct);
  const named = firstByAccessibleName(all, primary);
  return named === false ? primary : logSwap(logger, named);
}

export type { IPreferDirectArgs };
export { preferDirectEntry };
