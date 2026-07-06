/**
 * Yahav BaNCS scrape-call headers — the request headers every hard-model
 * `/account` POST carries. Combines the SPA's captured content-negotiation
 * headers (`X-Requested-With`, `Accept`, ... — sniffed at BIND from the
 * login-boot accounts request) with the per-session CSRF header. Without the
 * SPA headers the BaNCS server rejects a bare fetch with a generic 93194 whose
 * subject element is `origin`; the CSRF header clears the earlier 88521. The
 * CSRF header wins on a name clash (freshest per-session value).
 *
 * <p>The BIND sniff is best-effort: when the pooled accounts request carried no
 * captured request headers, the sniff yields an empty bag and the direct fetch
 * would draw a 93194 (intermittent — the observed Yahav zero-transactions
 * failure). {@link STATIC_SPA_HEADERS} is the deterministic fallback in that
 * case: the fixed Angular-XHR header set the SPA always sends, so every call
 * carries the XHR markers even when the capture missed them. A non-empty
 * capture always wins (its live values are preferred over the static set).
 */

import type { HeaderMap } from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { IActionContext } from '../../../Types/PipelineContext.js';
import { csrfHeaders, spaHeaders } from './YahavShapeEnvelope.js';

/**
 * The fixed Angular-XHR header set the BaNCS SPA sends on every request — the
 * deterministic fallback when the BIND capture found no request headers.
 */
const STATIC_SPA_HEADERS = Object.freeze({
  'x-requested-with': 'XMLHttpRequest',
  accept: 'application/json, text/plain, */*',
});

/**
 * The captured SPA header bag, or the static Angular-XHR fallback when the
 * BIND capture was empty (so every `/account` POST carries the XHR markers).
 * @param captured - SPA headers read from the session-context (may be empty).
 * @returns The captured bag when non-empty, else a fresh static fallback.
 */
function withSpaFallback(captured: HeaderMap): HeaderMap {
  return Object.keys(captured).length > 0 ? captured : { ...STATIC_SPA_HEADERS };
}

/**
 * Combined request headers for every Yahav hard-model call: the SPA header bag
 * (captured or static fallback) with the per-session CSRF header layered on top
 * (CSRF wins any name clash).
 * @param ctx - Action context.
 * @returns Merged header map.
 */
export function bancsHeaders(ctx: IActionContext): HeaderMap {
  const captured = spaHeaders(ctx);
  return { ...withSpaFallback(captured), ...csrfHeaders(ctx) };
}

export default bancsHeaders;
