/**
 * TxnParser — per-account identifier extraction from captured URLs.
 *
 * <p>Co-located sibling of {@link "./TxnParser.js"} carrying the
 * Result-Pattern query-string walker the harvest builder uses to
 * scope a captured TXN response to a single account when the bank
 * encodes the id in the URL (WK_ACCT.id aliases). Split out so the
 * parent file stays under the LoC cap.
 */

import { PIPELINE_WELL_KNOWN_ACCOUNT_FIELDS as WK_ACCT } from '../../Registry/WK/ScrapeWK.js';

/**
 * Outcome of inspecting one query-string pair for an account id.
 * Result-Pattern shape — `kind:'match'` means the pair carried an
 * account-id alias (the `value` is the decoded id, or `false` when
 * the alias was present but the value was empty); `kind:'skip'`
 * means the pair is unrelated and the loop should keep walking.
 */
type IPairOutcome =
  { readonly kind: 'match'; readonly value: string | false } | { readonly kind: 'skip' };

const PAIR_OUTCOME_SKIP: IPairOutcome = { kind: 'skip' };

/**
 * URI-decode `rawValue`; if the decoder throws on a malformed
 * percent sequence, return the raw value unchanged so the harvest
 * scope retains an identifying string instead of falling back to
 * unscoped.
 * @param rawValue - URL-encoded string fragment.
 * @returns Decoded string, or the raw value on decoder error.
 */
function safeDecodeUriComponent(rawValue: string): string {
  try {
    return decodeURIComponent(rawValue);
  } catch {
    return rawValue;
  }
}

/**
 * Returns true when `key` matches one of the WK_ACCT.id aliases —
 * i.e. the URL parameter names that banks use to scope a request to
 * a single account.
 * @param key - URL parameter name.
 * @returns True when the key is an account-id alias.
 */
function isAccountIdAlias(key: string): boolean {
  const idAliases: readonly string[] = WK_ACCT.id;
  return idAliases.includes(key);
}

/**
 * Project a non-empty raw value into the match-outcome carrying the
 * decoded string. Pulled out so {@link extractAccountIdFromPair}
 * stays under the LoC cap.
 * @param rawValue - URL-encoded fragment past the `=`.
 * @returns Match outcome with decoded value (or false on empty).
 */
function buildMatchOutcome(rawValue: string): IPairOutcome {
  if (rawValue === '') return { kind: 'match', value: false };
  return { kind: 'match', value: safeDecodeUriComponent(rawValue) };
}

/**
 * Inspect one `key=value` query-string pair. Returns a Result-Pattern
 * outcome: `kind:'match'` when the pair carried an account-id alias
 * (with the decoded value or `false` for empty), or `PAIR_OUTCOME_SKIP`
 * when the pair is unrelated.
 * @param pair - Query-string fragment (`key=value`).
 * @returns Pair outcome.
 */
function extractAccountIdFromPair(pair: string): IPairOutcome {
  const eq = pair.indexOf('=');
  if (eq <= 0) return PAIR_OUTCOME_SKIP;
  const key = pair.slice(0, eq);
  if (!isAccountIdAlias(key)) return PAIR_OUTCOME_SKIP;
  const rawValue = pair.slice(eq + 1);
  return buildMatchOutcome(rawValue);
}

/**
 * Locate the first {@link IPairOutcome} of kind 'match' from a list
 * of decoded query-string pairs. Returns the canonical SKIP sentinel
 * when no pair matched — keeps the Result-Pattern (no `undefined`
 * return).
 * @param pairs - Raw `key=value` fragments to inspect.
 * @returns Matched outcome or {@link PAIR_OUTCOME_SKIP} when nothing matched.
 */
function findFirstMatch(pairs: readonly string[]): IPairOutcome {
  const outcomes = pairs.map(extractAccountIdFromPair);
  const matched = outcomes.find((outcome): boolean => outcome.kind === 'match');
  return matched ?? PAIR_OUTCOME_SKIP;
}

/**
 * Extract a per-account identifier from the captured URL's query
 * string when one of the WK_ACCT.id keys is present. Returns `false`
 * when the URL has no recognised account-id query parameter — the
 * captured body is then treated as unscoped (single-account banks).
 * @param url - Captured endpoint URL.
 * @returns Extracted accountId or `false` when absent.
 */
function extractAccountIdFromUrl(url: string): string | false {
  const queryStart = url.indexOf('?');
  if (queryStart === -1) return false;
  const query = url.slice(queryStart + 1);
  const pairs = query.split('&');
  const matched = findFirstMatch(pairs);
  if (matched.kind === 'match') return matched.value;
  return false;
}

export default extractAccountIdFromUrl;
export { extractAccountIdFromUrl };
