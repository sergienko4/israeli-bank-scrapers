/**
 * Fetch sub-module barrel — explicit re-export surface.
 *
 * Mirrored the named-export set of the legacy `Mediator/Network/Fetch.ts`
 * monolith so that shim, and every external caller, compiled unchanged
 * through the split. The shim was deleted in v8.6; this barrel is now the
 * canonical wide-import surface, kept for callers that want the whole set.
 * Per CR cycle-1 directive: barrels are EXPLICIT (not `export *`) so
 * newly-introduced internal helpers never leak through.
 */

export type { JsonValue } from './Headers.js';
export { fetchGet, fetchGraphql, fetchPost, type IFetchGraphqlOptions } from './NativeFetch.js';
export { fetchGetWithinPage, fetchGetWithinPageWithHeaders } from './PageFetchGet.js';
export { fetchPostWithinPage, type IFetchPostOptions } from './PageFetchPost.js';
export type { IParseGetOpts, IParsePostOpts } from './ParseResult.js';
export { detectWafBlock } from './WafDetection.js';
