/**
 * Yahav BaNCS scrape-call headers — the request headers every hard-model
 * `/account` POST carries. Combines the SPA's captured content-negotiation
 * headers (`X-Requested-With`, `Accept`, ... — sniffed at BIND from the
 * login-boot accounts request) with the per-session CSRF header. Without the
 * SPA headers the BaNCS server rejects a bare fetch with a generic 93194 whose
 * subject element is `origin`; the CSRF header clears the earlier 88521. The
 * CSRF header wins on a name clash (freshest per-session value).
 */

import type { HeaderMap } from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { IActionContext } from '../../../Types/PipelineContext.js';
import { csrfHeaders, spaHeaders } from './YahavShapeEnvelope.js';

/**
 * Combined request headers for every Yahav hard-model call: the SPA header bag
 * with the per-session CSRF header layered on top (CSRF wins any name clash).
 * @param ctx - Action context.
 * @returns Merged header map.
 */
export function bancsHeaders(ctx: IActionContext): HeaderMap {
  return { ...spaHeaders(ctx), ...csrfHeaders(ctx) };
}

export default bancsHeaders;
