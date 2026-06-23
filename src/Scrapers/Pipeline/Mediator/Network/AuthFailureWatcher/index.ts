/**
 * AuthFailureWatcher barrel — explicit re-exports of the historical
 * public surface.
 *
 * Internal helpers in each tier file remain private; only the names
 * exposed by the legacy `Mediator/Network/AuthFailureWatcher.ts`
 * monolith leak through here.
 */

export { AUTH_REQ_TRACE_ENV_VAR, readAuthReqTraceGate } from './AuthReqTraceGate.js';
export { default as classifyBodyAsFailure } from './BodyClassifier.js';
export { createAuthFailureWatcher, createFrozenAuthFailureWatcher } from './Factory.js';
export { default as AUTH_BODY_FAILURE_PATTERNS } from './Patterns.js';
export type {
  AuthFailureClassifier,
  IAuthFailure,
  IAuthFailureWatcher,
  IBodyFailurePattern,
} from './Types.js';
export { isAuthEndpointUrl, isFailureStatusCode } from './UrlMatchers.js';
