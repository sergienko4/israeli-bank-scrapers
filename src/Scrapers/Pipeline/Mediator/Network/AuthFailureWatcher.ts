/**
 * Mediator/Network/AuthFailureWatcher — DEPRECATED LEGACY SHIM.
 *
 * @deprecated since v8.5 — import from `./AuthFailureWatcher/index.js`
 *   (wide) or a narrow sub-module (e.g.
 *   `./AuthFailureWatcher/Factory.js`) instead. This shim re-exports
 *   the historical AuthFailureWatcher surface so all historical
 *   importers compile unchanged. Slated for removal in v8.6.
 *
 * Phase 8.5a / Network canonical-10 drain: the 516-LoC monolith was
 * split into focused ≤ 150 LoC sub-modules under
 * `Mediator/Network/AuthFailureWatcher/` with every function ≤ 10
 * effective LoC.
 */

export type {
  AuthFailureClassifier,
  IAuthFailure,
  IAuthFailureWatcher,
  IBodyFailurePattern,
} from './AuthFailureWatcher/index.js';
export {
  AUTH_BODY_FAILURE_PATTERNS,
  AUTH_REQ_TRACE_ENV_VAR,
  classifyBodyAsFailure,
  createAuthFailureWatcher,
  createFrozenAuthFailureWatcher,
  isAuthEndpointUrl,
  isFailureStatusCode,
  readAuthReqTraceGate,
} from './AuthFailureWatcher/index.js';
