/**
 * Dashboard href extraction — triple-threat layer extraction.
 * Extracted from DashboardDiscoveryStep.ts to respect max-lines.
 */

import type { SelectorCandidate } from '../../Base/Config/LoginConfig.js';
import type { IElementMediator } from '../Mediator/Elements/ElementMediator.js';
import { WK_DASHBOARD } from '../Registry/WK/DashboardWK.js';
import { getDebug as createLogger } from '../Types/Debug.js';

const LOG = createLogger('dashboard-href');

/** SPA render timeout for href extraction. */
const TRIGGER_RENDER_TIMEOUT_MS = 10000;
type IsMatch = boolean;
type PatternMatch = boolean;
type ExtractedHref = string;
/** Sentinel for "no href found". */
const NO_HREF: ExtractedHref = '';

/**
 * Augment a candidate with target:'href'.
 * @param c - Original candidate.
 * @returns New candidate with target:'href'.
 */
function withHrefTarget(c: SelectorCandidate): SelectorCandidate {
  return { ...c, target: 'href' as const };
}

/**
 * Layer 1: ariaLabel-only href extraction.
 * @param mediator - Element mediator.
 * @param candidates - Full WK candidate list.
 * @returns Extracted href or empty.
 */
async function extractHrefLayer1(
  mediator: IElementMediator,
  candidates: readonly SelectorCandidate[],
): Promise<ExtractedHref> {
  const ariaOnly = candidates.filter((c): IsMatch => c.kind === 'ariaLabel');
  if (ariaOnly.length === 0) return NO_HREF;
  const hrefCandidates = ariaOnly.map(withHrefTarget);
  const timeout = TRIGGER_RENDER_TIMEOUT_MS;
  const race = await mediator.resolveVisible(hrefCandidates, timeout);
  const href = (race.found && race.value) || NO_HREF;
  LOG.debug('[PRE] L1 ariaLabel: found=%s href="%s"', race.found, href);
  return href;
}

/**
 * Layer 2: all candidates with href target.
 * @param mediator - Element mediator.
 * @param candidates - Full WK candidate list.
 * @returns Extracted href or empty.
 */
async function extractHrefLayer2(
  mediator: IElementMediator,
  candidates: readonly SelectorCandidate[],
): Promise<ExtractedHref> {
  const hrefCandidates = candidates.map(withHrefTarget);
  const timeout = TRIGGER_RENDER_TIMEOUT_MS;
  const race = await mediator.resolveVisible(hrefCandidates, timeout);
  const href = (race.found && race.value) || NO_HREF;
  LOG.debug('[PRE] L2 textContent: found=%s href="%s"', race.found, href);
  return href;
}

/**
 * Test if an href matches any WK transaction page pattern.
 * @param h - Href to test.
 * @returns True if matches.
 */
function matchesTxnPattern(h: string): IsMatch {
  const patterns = WK_DASHBOARD.TXN_PAGE_PATTERNS;
  return patterns.some((p): PatternMatch => p.test(h));
}

/**
 * Layer 3: brute-force DOM scan for transaction hrefs.
 * @param mediator - Element mediator.
 * @returns Matching href or empty.
 */
async function extractHrefLayer3(mediator: IElementMediator): Promise<ExtractedHref> {
  const allHrefs = await mediator.collectAllHrefs();
  const txnHref = allHrefs.find(matchesTxnPattern);
  const label = txnHref ?? 'none';
  LOG.debug('[PRE] L3 DOM scan: match=%s total=%d', label, allHrefs.length);
  return txnHref ?? '';
}

/**
 * Triple-Threat href extraction: ariaLabel -> textContent -> DOM scan.
 * @param mediator - Element mediator.
 * @returns Extracted href (empty if not found).
 */
async function extractTransactionHref(mediator: IElementMediator): Promise<ExtractedHref> {
  const candidates = WK_DASHBOARD.TRANSACTIONS as unknown as readonly SelectorCandidate[];
  const l1 = await extractHrefLayer1(mediator, candidates);
  if (l1) return l1;
  const l2 = await extractHrefLayer2(mediator, candidates);
  if (l2) return l2;
  return extractHrefLayer3(mediator);
}

export { extractTransactionHref, NO_HREF };
