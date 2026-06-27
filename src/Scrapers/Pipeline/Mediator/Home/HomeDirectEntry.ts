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
 */

import type { SelectorCandidate } from '../../../Base/Config/LoginConfigTypes.js';
import { WK_HOME } from '../../Registry/WK/HomeWK.js';
import type { ScraperLogger } from '../../Types/Debug.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import type { IElementMediator, IRaceResult } from '../Elements/ElementMediator.js';
import { HOME_RESOLVER_ENTRY_TIMEOUT_MS } from '../Timing/TimingConfig.js';
import type { NavStrategy } from './HomeStrategyClassify.js';
import { classifyStrategy, NAV_STRATEGY } from './HomeStrategyClassify.js';

/** Bundled args for {@link preferDirectEntry} — keeps params ≤3. */
interface IPreferDirectArgs {
  readonly mediator: IElementMediator;
  readonly primary: IRaceResult;
  readonly logger: ScraperLogger;
}

/**
 * Resolve every visible WK_HOME.ENTRY candidate in DOM order.
 * @param mediator - Element mediator providing the visibility race.
 * @returns Up to one result per candidate, empty when none visible.
 */
async function resolveAllEntries(mediator: IElementMediator): Promise<readonly IRaceResult[]> {
  const candidates = WK_HOME.ENTRY as unknown as readonly SelectorCandidate[];
  return mediator.resolveAllVisible(candidates, HOME_RESOLVER_ENTRY_TIMEOUT_MS, candidates.length);
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

/**
 * Prefer a navigable DIRECT entry when the primary race winner is an
 * href-less SEQUENTIAL trigger. Returns the primary unchanged for
 * DIRECT/MODAL winners (byte-identical for banks whose primary is
 * already navigable, e.g. Isracard) or when no DIRECT alternative is
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
  if (direct === false) return primary;
  logger.debug({ event: 'home.entry.prefer_direct', text: maskVisibleText(direct.value) });
  return direct;
}

export type { IPreferDirectArgs };
export { preferDirectEntry };
