/**
 * Resolves and composes URLs only within declared source and destination rules.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import { matchesAnyUrlRule } from '../../../Strategy/Fetch/UrlRule.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, succeed } from '../../../Types/Procedure.js';
import type { IUrlComposeMerge, IUrlComposeOp } from '../ConfigContracts/index.js';
import {
  hasValidEncoding,
  isQueryKey,
  isQueryText,
  MAX_QUERY_URL_CHARS,
  MAX_QUERY_VALUE_CHARS,
  queryValue,
} from './FlowUrlQuery.js';

interface IComposeInput {
  readonly parts: readonly string[];
  readonly subject: string;
}

/**
 * Whether a query pair contains safe, bounded decoded text.
 * @param pair - Query key and value.
 * @returns True for a safe pair.
 */
function isSafePair(pair: [string, string]): boolean {
  const [key, value] = pair;
  return isQueryKey(key) && (value === '' || isQueryText(value, MAX_QUERY_VALUE_CHARS));
}

/**
 * Parses a bounded URL without accepting malformed query encoding or controls.
 * @param text - URL text.
 * @param base - Optional resolution base.
 * @returns Parsed URL or false.
 */
function safeUrl(text: string, base?: string): URL | false {
  if (!isQueryText(text, MAX_QUERY_URL_CHARS)) return false;
  const url = URL.parse(text, base);
  if (url === null || !isQueryText(url.href, MAX_QUERY_URL_CHARS)) return false;
  if (!hasValidEncoding(url.search) || ![...url.searchParams].every(isSafePair)) return false;
  return url;
}

/**
 * Whether the supplied identity can be encoded without loss.
 * @param identity - Identity to place in the query.
 * @returns True for bounded, nonblank, well-formed text.
 */
function isSafeIdentity(identity: string): boolean {
  return isQueryText(identity, MAX_QUERY_VALUE_CHARS) && identity.trim() !== '';
}

/**
 * Whether all required query keys have one safe value.
 * @param entry - Checked source URL.
 * @param merge - Merge policy.
 * @returns True when the routing keys are unique and present.
 */
function hasRequiredKeys(entry: URL, merge: IUrlComposeMerge): boolean {
  if (merge.requiredKeys.length === 0) return false;
  return merge.requiredKeys.every((key): boolean => queryValue(entry.href, key) !== false);
}

/**
 * Merges the fresh entry query and overwrites the declared identity key.
 * @param target - Mutable, checked destination.
 * @param parts - Target, fresh entry and identity.
 * @param merge - Source and override policies.
 * @returns True when the merge is safe.
 */
function mergeQuery(target: URL, parts: readonly string[], merge: IUrlComposeMerge): boolean {
  if (parts.length !== 3 || !isSafeIdentity(parts[2]) || !isQueryKey(merge.setKey)) return false;
  const entry = safeUrl(parts[1]);
  if (entry === false || !matchesAnyUrlRule(entry, merge.source)) return false;
  if (!hasRequiredKeys(entry, merge)) return false;
  for (const [key, value] of entry.searchParams) target.searchParams.set(key, value);
  target.searchParams.set(merge.setKey, parts[2]);
  return true;
}

/**
 * Applies an optional merge or requires a single source when none is set.
 * @param target - Checked target.
 * @param parts - Resolved derivation parts.
 * @param op - Composition policy.
 * @returns True when the parts satisfy the policy.
 */
function applyMerge(target: URL, parts: readonly string[], op: IUrlComposeOp): boolean {
  if (op.merge === undefined) return parts.length === 1;
  return mergeQuery(target, parts, op.merge);
}

/**
 * Resolves a target, applies its query policy and rechecks the final URL.
 * @param parts - Resolved derivation parts.
 * @param op - Source and destination policy.
 * @returns Checked URL or false.
 */
function composedUrl(parts: readonly string[], op: IUrlComposeOp): string | false {
  if (parts.length === 0) return false;
  const target = safeUrl(parts[0], op.base);
  if (target === false || !matchesAnyUrlRule(target, op.source)) return false;
  if (!applyMerge(target, parts, op)) return false;
  if (op.path !== undefined) target.pathname = op.path;
  if (!isQueryText(target.href, MAX_QUERY_URL_CHARS)) return false;
  return matchesAnyUrlRule(target, op.url) ? target.href : false;
}

/**
 * Produces a checked URL or a value-free refusal.
 * @param input - Resolved parts and failure subject.
 * @param op - Composition policy.
 * @returns URL or a generic failure.
 */
function runUrlCompose(input: IComposeInput, op: IUrlComposeOp): Procedure<string> {
  const url = composedUrl(input.parts, op);
  if (url === false) return fail(ScraperErrorTypes.Generic, `${input.subject} unformattable`);
  return succeed(url);
}

export default runUrlCompose;
export { runUrlCompose };
