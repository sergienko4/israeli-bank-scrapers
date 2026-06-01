/**
 * Common ↔ Pipeline UNIFY shim (Phase 3 — Commit 4 of 11).
 *
 * This file is a pure re-export of the canonical Pipeline Fetch surface.
 * Per the user mandate (2026-06-01) "Pipeline is canonical, non-Pipeline is
 * deprecated", the duplicate Common implementation (~430 LoC) has been
 * collapsed into this shim so that legacy callers
 * (`BehatsdaaScraper`, `MizrahiScraper`, `MizrahiHelpers`,
 * `MizrahiRequestData`) keep compiling against `src/Common/Fetch.js`
 * while every symbol now resolves to the canonical-10 Pipeline split at
 * `Pipeline/Mediator/Network/Fetch/index.ts`.
 *
 * The shim points at `Fetch/index.js` (the canonical destination of the
 * 8.5a Network split), bypassing the deprecated Pipeline-side shim at
 * `Pipeline/Mediator/Network/Fetch.ts`.
 *
 * No brand-type wrappers are needed: all public signatures use plain
 * types (`Promise<TResult>`, `string`, `Record<string, string>`,
 * `IFetchPostOptions`, etc.). A direct `export … from` is sufficient.
 *
 * @deprecated Import from
 * `src/Scrapers/Pipeline/Mediator/Network/Fetch/index.ts` directly.
 * This shim will be deleted when the last caller migrates.
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
} from '../Scrapers/Pipeline/Mediator/Network/Fetch/index.js';
