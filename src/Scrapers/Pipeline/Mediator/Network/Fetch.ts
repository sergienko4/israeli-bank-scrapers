/**
 * Mediator/Network/Fetch — DEPRECATED LEGACY SHIM.
 *
 * @deprecated since v8.5 — import from `./Fetch/index.js` (wide) or a
 *   narrow per-bucket sub-module (e.g. `./Fetch/NativeFetch.js`)
 *   instead. This shim re-exports the full Fetch surface so the
 *   12 historical importers compile unchanged. Slated for removal in v8.6.
 *
 * Phase 8.5a / Network canonical-10 drain: the 464-LoC monolith was
 * split into focused ≤ 150 LoC sub-modules under `Mediator/Network/Fetch/`
 * with every function ≤ 10 effective LoC.
 */

export {
  detectWafBlock,
  fetchGet,
  fetchGetWithinPage,
  fetchGetWithinPageWithHeaders,
  fetchGraphql,
  fetchPost,
  fetchPostWithinPage,
  type IFetchGraphqlOptions,
  type IFetchPostOptions,
  type IParseGetOpts,
  type IParsePostOpts,
  type JsonValue,
} from './Fetch/index.js';
