/**
 * BIND-API-MEDIATOR session-token prime — capture a body-borne session id
 * (e.g. Leumi's WCF `reqObj.SessionHeader.SessionID`) from the live discovery
 * pool and stash it on the mediator session-context as `sessionToken`.
 *
 * Why the pool already holds it: the network-trace lifecycle interceptor opens
 * capture at `pre-login`, so every API call the SPA fires during login/boot is
 * recorded before BIND runs. This prime inspects ONLY the endpoint matched by
 * `urlMatch` (never credential POSTs) and reads the declared token path — so it
 * is PII-safe by extraction scope. Opt-in per bank via `sessionTokenCapture`;
 * banks that omit it yield `none()` (header-token / cookie banks). Mirrors the
 * client-version prime — merges into the existing context, no bank coupling.
 */

import type { IApiMediator } from '../../Mediator/Api/ApiMediator.types.js';
import type { INetworkDiscovery } from '../../Mediator/Network/Types/Discovery.js';
import type { IDiscoveredEndpoint } from '../../Mediator/Network/Types/Endpoint.js';
import type { IPipelineBankConfig } from '../../Registry/Config/PipelineBankConfigTypes.js';
import type { Option } from '../../Types/Option.js';
import { none, some } from '../../Types/Option.js';

/** Non-optional view of the per-bank session-token capture spec. */
type ISessionTokenCapture = NonNullable<IPipelineBankConfig['sessionTokenCapture']>;

/** Wrapped JSON-parse result — flag + always-present body (no null returns). */
interface IParsed {
  readonly ok: boolean;
  readonly body: Record<string, unknown>;
}

/** Shared empty parse result — reused so failures allocate nothing. */
const EMPTY_PARSED: IParsed = { ok: false, body: {} };

/**
 * Narrow a parsed JSON value to a plain object wrapper.
 * @param parsed - Value produced by `JSON.parse`.
 * @returns Wrapped body when it is a non-array object, else empty.
 */
function toParsedObject(parsed: unknown): IParsed {
  if (parsed === null) return EMPTY_PARSED;
  if (typeof parsed !== 'object') return EMPTY_PARSED;
  if (Array.isArray(parsed)) return EMPTY_PARSED;
  return { ok: true, body: parsed as Record<string, unknown> };
}

/**
 * Parse a JSON string into an object wrapper, tolerating malformed input.
 * @param raw - Candidate JSON string.
 * @returns Wrapped body, or empty when parse fails.
 */
function tryParseObject(raw: string): IParsed {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return toParsedObject(parsed);
  } catch {
    return EMPTY_PARSED;
  }
}

/**
 * Resolve the object to walk — a double-encoded field (WCF `reqObj`) parsed as
 * JSON, or the outer body when no field is declared.
 * @param outer - Parsed top-level postData wrapper.
 * @param spec - Session-token capture spec.
 * @returns Inner-body wrapper to walk.
 */
function resolveInnerBody(outer: IParsed, spec: ISessionTokenCapture): IParsed {
  if (!outer.ok) return EMPTY_PARSED;
  if (spec.bodyField === undefined) return outer;
  const nested = outer.body[spec.bodyField];
  if (typeof nested !== 'string') return EMPTY_PARSED;
  return tryParseObject(nested);
}

/**
 * Advance one key into a nested record; `false` marks a dead-end branch.
 * @param acc - Current node (object to descend, or `false` once dead).
 * @param key - Next key in the token path.
 * @returns Child value, or `false` when the branch cannot continue.
 */
function stepInto(acc: unknown, key: string): unknown {
  if (typeof acc !== 'object' || acc === null) return false;
  const rec = acc as Record<string, unknown>;
  return rec[key] ?? false;
}

/**
 * Narrow a walked leaf to a non-empty string.
 * @param node - Terminal value reached by the path walk.
 * @returns Non-empty string, or `false`.
 */
function asNonEmptyString(node: unknown): string | false {
  return typeof node === 'string' && node.length > 0 ? node : false;
}

/**
 * Walk an ordered key path through nested records to a string leaf.
 * @param root - Inner body object.
 * @param path - Ordered keys to the token.
 * @returns Non-empty token string, or `false`.
 */
function walkToToken(root: Record<string, unknown>, path: readonly string[]): string | false {
  const seed: unknown = root;
  const leaf = path.reduce((acc: unknown, key: string): unknown => stepInto(acc, key), seed);
  return asNonEmptyString(leaf);
}

/**
 * Extract the token from a single capture's postData per the spec.
 * @param ep - Captured endpoint.
 * @param spec - Session-token capture spec.
 * @returns Token string, or `false` when this capture has none.
 */
function tokenFromEndpoint(ep: IDiscoveredEndpoint, spec: ISessionTokenCapture): string | false {
  if (ep.method !== 'POST') return false;
  const isUrlMatch = ep.url.includes(spec.urlMatch);
  if (!isUrlMatch) return false;
  const outer = tryParseObject(ep.postData);
  const inner = resolveInnerBody(outer, spec);
  if (!inner.ok) return false;
  return walkToToken(inner.body, spec.tokenPath);
}

/**
 * Scan the discovery pool for the first capture yielding a token.
 * @param pool - Login-inclusive discovery captures.
 * @param spec - Session-token capture spec.
 * @returns Token string, or `false`.
 */
function extractSessionToken(
  pool: readonly IDiscoveredEndpoint[],
  spec: ISessionTokenCapture,
): string | false {
  const tokens = pool.map((ep): string | false => tokenFromEndpoint(ep, spec));
  const hit = tokens.find((token): boolean => token !== false);
  return hit ?? false;
}

/**
 * Prime the mediator session-context with a captured session token for banks
 * that declare `sessionTokenCapture` (yields `none()` otherwise). Reads the
 * element mediator's login-inclusive pool once; merges into the existing
 * context. The pool already holds the login-boot captures at BIND, so no poll.
 * @param config - Resolved bank config carrying `sessionTokenCapture`.
 * @param network - Element-mediator network discovery (login captures).
 * @param mediator - Browser-page mediator to enrich.
 * @returns `some(token)` when stashed, `none()` otherwise.
 */
function primeSessionToken(
  config: IPipelineBankConfig,
  network: INetworkDiscovery,
  mediator: IApiMediator,
): Option<string> {
  const spec = config.sessionTokenCapture;
  if (!spec) return none();
  const pool = network.getAllEndpoints();
  const token = extractSessionToken(pool, spec);
  if (token === false) return none();
  const merged = { ...mediator.getSessionContext(), sessionToken: token };
  mediator.setSessionContext(merged);
  return some(token);
}

export default primeSessionToken;
export { extractSessionToken, primeSessionToken };
