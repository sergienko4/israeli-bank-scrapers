/**
 * URL rules — the exact allow-list a redirect target must match (N2). A
 * target passes only over https, with no userinfo and no fragment, when its
 * origin, its path (case-insensitively) and its query match one rule.
 */

import type { IUrlRule } from '../../Types/Domain/FetchPolicy.js';

/** Query keys and the one value each must carry. */
type RequiredQuery = Readonly<Record<string, string>>;

/**
 * Whether a URL is https with no userinfo and no fragment — even an empty
 * one, which `URL.hash` reports as ''.
 * @param target - Candidate URL.
 * @returns True when the URL may be matched at all.
 */
function isCleanHttps(target: URL): boolean {
  if (target.protocol !== 'https:') return false;
  if (target.username !== '' || target.password !== '') return false;
  return !target.href.includes('#');
}

/**
 * Whether the target path equals one allowed path, ignoring case.
 * @param target - Candidate URL.
 * @param rule - Rule to match.
 * @returns True when the path is allowed.
 */
function isPathAllowed(target: URL, rule: IUrlRule): boolean {
  const path = target.pathname.toLowerCase();
  return rule.paths.some((allowed): boolean => allowed.toLowerCase() === path);
}

/**
 * Whether a required key appears exactly once with its value.
 * @param params - Target query.
 * @param entry - Required key and value.
 * @returns True when the key holds.
 */
function holdsOnce(params: URLSearchParams, entry: readonly [string, string]): boolean {
  const values = params.getAll(entry[0]);
  return values.length === 1 && values[0] === entry[1];
}

/**
 * Whether every key is required and appears once.
 * @param params - Target query.
 * @param required - Required keys.
 * @returns True when no foreign or duplicate key appears.
 */
function hasOnlyRequiredKeys(params: URLSearchParams, required: RequiredQuery): boolean {
  const keys = [...params.keys()];
  const isUnique = new Set(keys).size === keys.length;
  return isUnique && keys.every((key): boolean => Object.hasOwn(required, key));
}

/**
 * Whether the target query satisfies the rule.
 * @param target - Candidate URL.
 * @param rule - Rule to match.
 * @returns True when the query is allowed.
 */
function isQueryAllowed(target: URL, rule: IUrlRule): boolean {
  const required = rule.query ?? {};
  const params = target.searchParams;
  const entries = Object.entries(required);
  if (!entries.every((entry): boolean => holdsOnce(params, entry))) return false;
  return rule.exactQuery !== true || hasOnlyRequiredKeys(params, required);
}

/**
 * Whether the target matches one rule's origin, path and query.
 * @param target - Candidate URL (already https, no userinfo, no fragment).
 * @param rule - Rule to match.
 * @returns True on a match.
 */
function matchesUrlRule(target: URL, rule: IUrlRule): boolean {
  if (target.origin !== rule.origin) return false;
  return isPathAllowed(target, rule) && isQueryAllowed(target, rule);
}

/**
 * Whether a URL is clean https and matches at least one rule.
 * @param target - Candidate URL.
 * @param rules - Allowed rules.
 * @returns True when the URL is allowed.
 */
function matchesAnyUrlRule(target: URL, rules: readonly IUrlRule[]): boolean {
  if (!isCleanHttps(target)) return false;
  return rules.some((rule): boolean => matchesUrlRule(target, rule));
}

export default matchesAnyUrlRule;
export { matchesAnyUrlRule };
