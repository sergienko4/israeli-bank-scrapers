/**
 * BALANCE-RESOLVE.pre planner (v6).
 *
 * <p>Reads the {@link IAccountIdentity} map + {@link IBalanceFetchTemplate}
 * SCRAPE.post emitted, then builds the per-bank-account
 * {@link IBalanceFetchPlanEntry} list (deduplicated by
 * `bankAccountUniqueId`). Default-deny (coding-principle-guidlines §4)
 * — returns an empty array when either input is missing or empty.
 *
 * <p>Bulk endpoints (template missing all of postBodyKey, urlQueryKey
 * and urlPathInterpolation) emit a single `__BULK__` plan entry that
 * covers every card — the bulk response carries all per-card data.
 */

import type {
  IAccountIdentity,
  IBalanceFetchPlanEntry,
  IBalanceFetchRequest,
  IBalanceFetchTemplate,
} from '../../Types/PipelineContext.js';

/** Empty plan sentinel — exported so callers can compare without re-allocating. */
const EMPTY_PLAN: readonly IBalanceFetchPlanEntry[] = Object.freeze([]);

/** Identifier used when the template is a bulk endpoint covering every card. */
const BULK_KEY = '__BULK__';

/**
 * Build a POST request body containing the bankAccountUniqueId.
 * @param key - POST body key carrying the id.
 * @param id - bankAccountUniqueId value.
 * @returns JSON-encoded body string.
 */
function buildPostBody(key: string, id: string): string {
  const payload: Record<string, string> = { [key]: id };
  return JSON.stringify(payload);
}

/**
 * Build a POST IBalanceFetchRequest carrying bankAccountUniqueId in the body.
 * @param template - Fetch template (POST).
 * @param id - bankAccountUniqueId to interpolate.
 * @param postBodyKey - Narrowed body key (caller guarantees defined).
 * @returns Materialised POST request.
 */
function buildPostRequest(
  template: IBalanceFetchTemplate,
  id: string,
  postBodyKey: string,
): IBalanceFetchRequest {
  const headers = template.headers ?? {};
  const body = buildPostBody(postBodyKey, id);
  return { url: template.url, method: 'POST', body, headers };
}

/**
 * Build a GET IBalanceFetchRequest by interpolating into the URL path.
 * @param template - Fetch template (GET, urlPathInterpolation).
 * @param id - bankAccountUniqueId to interpolate.
 * @returns Materialised GET request.
 */
function buildGetPathRequest(template: IBalanceFetchTemplate, id: string): IBalanceFetchRequest {
  const headers = template.headers ?? {};
  const encoded = encodeURIComponent(id);
  const url = template.url.replace('<ID>', encoded);
  return { url, method: 'GET', body: '', headers };
}

/**
 * Build a GET IBalanceFetchRequest by substituting a query-string parameter.
 * @param template - Fetch template (GET, urlQueryKey).
 * @param id - bankAccountUniqueId to interpolate.
 * @param urlQueryKey - Narrowed query key (caller guarantees defined).
 * @returns Materialised GET request.
 */
function buildGetQueryRequest(
  template: IBalanceFetchTemplate,
  id: string,
  urlQueryKey: string,
): IBalanceFetchRequest {
  const headers = template.headers ?? {};
  const url = substituteQueryParam(template.url, urlQueryKey, id);
  return { url, method: 'GET', body: '', headers };
}

/**
 * Build a bulk IBalanceFetchRequest with no id substitution.
 * @param template - Fetch template (bulk endpoint).
 * @returns Materialised request.
 */
function buildBulkRequest(template: IBalanceFetchTemplate): IBalanceFetchRequest {
  const headers = template.headers ?? {};
  return { url: template.url, method: template.method, body: '', headers };
}

/**
 * Materialise a single live IBalanceFetchRequest by selecting the right
 * substitution strategy from the template's discriminating fields.
 * @param template - Fetch template.
 * @param id - bankAccountUniqueId to interpolate.
 * @returns Materialised request.
 */
function buildRequest(template: IBalanceFetchTemplate, id: string): IBalanceFetchRequest {
  if (template.method === 'POST' && template.postBodyKey !== undefined) {
    return buildPostRequest(template, id, template.postBodyKey);
  }
  if (template.urlPathInterpolation === true) return buildGetPathRequest(template, id);
  if (template.method === 'GET' && template.urlQueryKey !== undefined) {
    return buildGetQueryRequest(template, id, template.urlQueryKey);
  }
  return buildBulkRequest(template);
}

/**
 * Replace the value of `key` in a URL's query string with `value`.
 * @param url - Original URL.
 * @param key - Query parameter name.
 * @param value - Replacement value.
 * @returns URL with the query value replaced.
 */
function substituteQueryParam(url: string, key: string, value: string): string {
  const parsed = tryParseUrl(url);
  if (parsed === false) {
    const encoded = encodeURIComponent(value);
    return url.replace('<ID>', encoded);
  }
  parsed.searchParams.set(key, value);
  return parsed.toString();
}

/**
 * Parse a URL string, returning the parsed URL or `false` when malformed.
 * Avoids throwing across module boundaries.
 *
 * @param url - Raw URL.
 * @returns Parsed URL or `false` when malformed.
 */
function tryParseUrl(url: string): URL | false {
  try {
    return new URL(url);
  } catch {
    return false;
  }
}

/**
 * Reports whether the template covers every card in one bulk call.
 *
 * @param template - Fetch template.
 * @returns True when no per-account substitution key is set.
 */
function isBulkTemplate(template: IBalanceFetchTemplate): boolean {
  return (
    template.postBodyKey === undefined &&
    template.urlQueryKey === undefined &&
    template.urlPathInterpolation !== true
  );
}

/**
 * Build the single-entry bulk plan covering every card via one call.
 *
 * @param template - Bulk fetch template.
 * @returns Single-entry plan with the BULK_KEY sentinel.
 */
function bulkPlan(template: IBalanceFetchTemplate): readonly IBalanceFetchPlanEntry[] {
  const request = buildRequest(template, BULK_KEY);
  return [{ bankAccountUniqueId: BULK_KEY, request }];
}

/** Per-call accumulator bundle for {@link appendIfNew}. */
interface IAppendAccumulator {
  readonly template: IBalanceFetchTemplate;
  readonly seen: Set<string>;
  readonly out: IBalanceFetchPlanEntry[];
}

/**
 * Append a plan entry for one bank-account id, skipping when already seen.
 *
 * @param id - Identity tuple.
 * @param acc - Accumulator bundle (template + dedup-set + output array).
 * @returns True when a new entry was appended.
 */
function appendIfNew(id: IAccountIdentity, acc: IAppendAccumulator): boolean {
  if (acc.seen.has(id.bankAccountUniqueId)) return false;
  acc.seen.add(id.bankAccountUniqueId);
  const request = buildRequest(acc.template, id.bankAccountUniqueId);
  acc.out.push({ bankAccountUniqueId: id.bankAccountUniqueId, request });
  return true;
}

/**
 * Dedupe identities by bankAccountUniqueId, materialising one plan entry
 * per unique bank account.
 *
 * @param identities - SCRAPE-emitted per-card identities.
 * @param template - SCRAPE-emitted fetch template (per-bank-account).
 * @returns Plan entries (one per unique bankAccountUniqueId).
 */
function perBankAccountPlan(
  identities: ReadonlyMap<string, IAccountIdentity>,
  template: IBalanceFetchTemplate,
): readonly IBalanceFetchPlanEntry[] {
  const acc: IAppendAccumulator = {
    template,
    seen: new Set<string>(),
    out: [],
  };
  for (const id of identities.values()) appendIfNew(id, acc);
  return acc.out;
}

/**
 * Build the per-bank-account fetch plan from SCRAPE.post emissions.
 *
 * <p>Returns the EMPTY_PLAN sentinel on default-deny (absent
 * identities OR absent template OR empty identities). Bulk templates
 * emit a single `__BULK__` entry that covers every card.
 *
 * @param identities - SCRAPE-emitted per-card identities (may be empty).
 * @param template - SCRAPE-emitted fetch template (may be absent).
 * @returns Plan entries, or {@link EMPTY_PLAN} for the default-deny case.
 */
export function buildBalanceFetchPlan(
  identities: ReadonlyMap<string, IAccountIdentity>,
  template: IBalanceFetchTemplate,
): readonly IBalanceFetchPlanEntry[] {
  if (identities.size === 0) return EMPTY_PLAN;
  if (template.url.length === 0) return EMPTY_PLAN;
  if (isBulkTemplate(template)) return bulkPlan(template);
  return perBankAccountPlan(identities, template);
}

export { BULK_KEY, EMPTY_PLAN };
