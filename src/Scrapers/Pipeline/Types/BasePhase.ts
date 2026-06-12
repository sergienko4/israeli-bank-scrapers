/**
 * Legacy import path for the abstract `BasePhase` class.
 *
 * <p>Phase 12b sub-step 4/4 (2026-06) moved the class body to its
 * semantically correct home at {@link "../Phases/Base/BasePhase.js"}
 * alongside its module-private helpers. This file remains as a
 * back-compat shim for the v8.5 release window so existing callers of
 * the historic `Pipeline/Types/BasePhase.js` path keep working without
 * source changes. All three previously-public symbols are re-exported
 * verbatim:
 *
 *   * `default` (the BasePhase class as the default export)
 *   * `BasePhase` (the same class as a named export)
 *   * `IsPrePayloadValid` (the Brand<boolean> PRE-payload validity tag)
 *
 * No runtime cost: barrel re-exports are erased by tsup at bundle
 * time, so `lib/index.{cjs,mjs,d.ts}` byte-content is unchanged.
 *
 * @deprecated since v8.5 — import from `../Phases/Base/BasePhase.js`
 *   directly. This shim will be removed in v8.6 once the cluster
 *   consolidation finishes.
 */
export { BasePhase, default, type IsPrePayloadValid } from '../Phases/Base/BasePhase.js';
