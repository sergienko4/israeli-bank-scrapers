/**
 * Pure transition matcher — given a request, the simulator's current
 * phase, and the bank's manifest transitions, returns at most one
 * matching transition or signals ambiguity.
 *
 * Isolated as a pure function so the state-machine logic is
 * exercisable by deterministic unit tests, with the
 * Playwright-aware {@link MirrorSimulator} composing it.
 *
 * Matching rules (all must hold):
 *
 *   1. transition.phase === current simulator phase
 *   2. transition.method === request.method
 *   3. transition.urlPattern matches the request URL (regex when starting
 *      with `^`, substring otherwise)
 *   4. transition.resourceType (when set) matches request.resourceType
 *   5. transition.postData (when set) matches the parsed body
 *   6. transition.headers (when set) match request.headers
 *
 * Determinism rule: at most ONE transition may match. When multiple
 * match the matcher returns an `ambiguous` outcome so the simulator
 * fails loudly; manifests are repo-owned so contributors can split
 * the conflicting predicate further (e.g., add a postData shape).
 *
 * @see ./MirrorManifest.ts
 * @see ./MirrorSimulator.ts
 */

import { none, type Option, some } from '../../../Scrapers/Pipeline/Types/Option.js';
import type { IntegrationPhase } from '../Phases/IntegrationPhase.js';
import type {
  IHeaderPredicate,
  IMirrorTransition,
  IPostDataPredicate,
  MirrorResourceType,
} from './MirrorManifest.js';

/** Outcome tag for a single-transition match. */
type MatchKind = 'matched' | 'none' | 'ambiguous';

/** Outcome of a match attempt — discriminated union. */
interface IMatchOutcome {
  readonly kind: MatchKind;
  readonly transition: Option<IMirrorTransition>;
}

/** Request facts the matcher evaluates. */
interface IMatchRequest {
  readonly method: string;
  readonly url: string;
  readonly resourceType: MirrorResourceType;
  readonly postBody: string;
  readonly headers: ReadonlyMap<string, string>;
}

/** Bundle for {@link matchTransition}. */
interface IMatchArgs {
  readonly request: IMatchRequest;
  readonly currentPhase: IntegrationPhase;
  readonly transitions: readonly IMirrorTransition[];
}

/**
 * Returns true when the URL satisfies a substring or regex pattern.
 *
 * @param pattern - Pattern string from the manifest.
 * @param url - Full request URL.
 * @returns True when the URL matches.
 */
function matchesUrlPattern(pattern: string, url: string): boolean {
  if (pattern.startsWith('^')) return tryRegexMatch(pattern, url);
  return url.includes(pattern);
}

/**
 * Try to compile + execute a regex; returns false on bad regex.
 *
 * @param pattern - Regex source string.
 * @param url - URL to test.
 * @returns True on match, false on failure or no match.
 */
function tryRegexMatch(pattern: string, url: string): boolean {
  try {
    const rx = new RegExp(pattern);
    return rx.test(url);
  } catch {
    return false;
  }
}

/**
 * Apply the POST body predicate using its declared shape.
 *
 * @param predicate - Manifest postData predicate.
 * @param body - Raw POST body.
 * @returns True when every expectation key matches.
 */
function matchesPostData(predicate: IPostDataPredicate, body: string): boolean {
  const parsed = parsePostBody(predicate.shape, body);
  for (const key of Object.keys(predicate.expectations)) {
    if (parsed[key] !== predicate.expectations[key]) return false;
  }
  return true;
}

/**
 * Parse the body according to its shape (errors yield empty map).
 *
 * @param shape - JSON vs URL-encoded form.
 * @param body - Raw body.
 * @returns Flat string-keyed map.
 */
function parsePostBody(shape: 'json' | 'form', body: string): Record<string, string> {
  if (shape === 'json') return parseJsonBodySafe(body);
  return parseFormBody(body);
}

/**
 * Safe JSON parse + flatten to string-keyed map.
 *
 * @param body - Raw JSON body.
 * @returns Flat string-keyed map; empty on parse error.
 */
function parseJsonBodySafe(body: string): Record<string, string> {
  try {
    const raw = JSON.parse(body) as Record<string, unknown>;
    return flattenJsonToStrings(raw);
  } catch {
    return {};
  }
}

/**
 * Coerce every top-level JSON value to its string form.
 *
 * @param raw - Parsed JSON object.
 * @returns Flat string-keyed map.
 */
function flattenJsonToStrings(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(raw)) {
    const value = raw[key];
    out[key] = typeof value === 'string' ? value : JSON.stringify(value);
  }
  return out;
}

/**
 * Parse URL-encoded form body to a flat map.
 *
 * @param body - Raw form body.
 * @returns Flat string-keyed map.
 */
function parseFormBody(body: string): Record<string, string> {
  const params = new URLSearchParams(body);
  const out: Record<string, string> = {};
  for (const [key, value] of params.entries()) out[key] = value;
  return out;
}

/**
 * Returns true when every header predicate is satisfied.
 *
 * @param predicates - Header predicates from the manifest.
 * @param headers - Lower-cased request headers.
 * @returns True when every predicate holds.
 */
function matchesHeaders(
  predicates: readonly IHeaderPredicate[],
  headers: ReadonlyMap<string, string>,
): boolean {
  for (const predicate of predicates) {
    const lowerName = predicate.name.toLowerCase();
    const actual = headers.get(lowerName);
    if (actual === undefined) return false;
    if (predicate.value !== undefined && actual !== predicate.value) return false;
  }
  return true;
}

/**
 * Check ONE transition against the request — all declared predicates
 * must hold; absent predicates skip silently.
 *
 * @param transition - Candidate transition.
 * @param request - Request facts.
 * @returns True when the transition fits the request.
 */
function fitsTransition(transition: IMirrorTransition, request: IMatchRequest): boolean {
  if (transition.method !== request.method) return false;
  if (!matchesUrlPattern(transition.urlPattern, request.url)) return false;
  if (transition.resourceType !== undefined && transition.resourceType !== request.resourceType) {
    return false;
  }
  if (
    transition.postData !== undefined &&
    !matchesPostData(transition.postData, request.postBody)
  ) {
    return false;
  }
  if (transition.headers !== undefined && !matchesHeaders(transition.headers, request.headers)) {
    return false;
  }
  return true;
}

/**
 * Build the outcome object based on the number of hits.
 *
 * @param hits - Matched transitions.
 * @returns The outcome wrapping zero / one / many hits.
 */
function summarizeHits(hits: readonly IMirrorTransition[]): IMatchOutcome {
  if (hits.length === 0) return { kind: 'none', transition: none() };
  if (hits.length === 1) return { kind: 'matched', transition: some(hits[0]) };
  return { kind: 'ambiguous', transition: none() };
}

/**
 * Run the deterministic match over the manifest transitions.
 *
 * @param args - Request + current phase + manifest transitions.
 * @returns Outcome wrapping the matched transition (if any).
 */
function matchTransition(args: IMatchArgs): IMatchOutcome {
  const hits: IMirrorTransition[] = [];
  for (const transition of args.transitions) {
    if (transition.phase !== args.currentPhase) continue;
    if (fitsTransition(transition, args.request)) hits.push(transition);
  }
  return summarizeHits(hits);
}

export type { IMatchArgs, IMatchOutcome, IMatchRequest, MatchKind };
export { matchTransition };
