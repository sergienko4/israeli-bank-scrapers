/**
 * Shared transactions-page URL matcher.
 *
 * <p>The single production predicate for "does this URL/href point at a known
 * transactions page?". Extracted so the DASHBOARD click-walker, dashboard href
 * extraction, and ACCOUNT-RESOLVE nudge all decide through ONE implementation
 * — and so tests assert against the exact predicate the runtime uses, instead
 * of re-implementing `TXN_PAGE_PATTERNS.some(...)` at each call site.
 */

import type { Brand } from '../../Types/Brand.js';
import { WK_DASHBOARD } from './DashboardWK.js';

/** Branded result of {@link isTxnPageUrl} (Rule #15 — no bare primitive return). */
type IsTxnPageUrl = Brand<boolean, 'IsTxnPageUrl'>;

/**
 * Whether `url` matches any well-known transactions-page pattern.
 * @param url - Candidate URL or href.
 * @returns True iff any {@link WK_DASHBOARD.TXN_PAGE_PATTERNS} entry matches.
 */
export function isTxnPageUrl(url: string): IsTxnPageUrl {
  const isHit = WK_DASHBOARD.TXN_PAGE_PATTERNS.some((pattern): boolean => pattern.test(url));
  return isHit as IsTxnPageUrl;
}

export default isTxnPageUrl;
