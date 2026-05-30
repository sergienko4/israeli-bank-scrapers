/**
 * Mediator/Network/AuthDiscovery — DEPRECATED LEGACY SHIM.
 *
 * @deprecated since v8.5 — import from `./AuthDiscovery/index.js` (wide)
 *   or a narrow per-tier sub-module (e.g. `./AuthDiscovery/PollTier.js`)
 *   instead. This shim re-exports the historical AuthDiscovery surface
 *   so all 4 historical importers compile unchanged. Slated for removal
 *   in v8.6.
 *
 * Phase 8.5a / Network canonical-10 drain: the 425-LoC monolith was
 * split into focused ≤ 150 LoC tier sub-modules under
 * `Mediator/Network/AuthDiscovery/` with every function ≤ 10
 * effective LoC.
 */

export {
  AUTH_HEADER_NAMES,
  discoverAuthThreeTier,
  discoverFromHeaders,
} from './AuthDiscovery/index.js';
