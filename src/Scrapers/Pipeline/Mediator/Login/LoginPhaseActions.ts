/**
 * LOGIN phase Mediator actions — PRE/ACTION/POST/FINAL barrel.
 *
 * <p>Phase 2d strict-cluster split: this file is a thin re-export
 * barrel. All implementation lives in the co-located helper modules:
 * {@link ./LoginPreOrchestrator}, {@link ./LoginActionExecute},
 * {@link ./LoginPostValidate}, {@link ./LoginScopeIntact},
 * {@link ./LoginFrameScan}, {@link ./LoginUrlHelpers},
 * {@link ./LoginFormAnchor}, {@link ./LoginCookieAudit}.
 */

export { executeFillAndSubmitFromDiscovery } from './LoginActionExecute.js';
export { executeLoginSignal } from './LoginCookieAudit.js';
export { extractFormAnchorSelector } from './LoginFormAnchor.js';
export { discoverErrorsAllFrames, safeScanFrame } from './LoginFrameScan.js';
export { executeValidateLogin } from './LoginPostValidate.js';
// Internal helpers exposed for focused unit tests. Do NOT import outside src/Tests.
export { detectAsyncLoginErrors } from './LoginPostValidate.js';
export { executeDiscoverForm } from './LoginPreOrchestrator.js';
export { validateActionScopeIntact } from './LoginScopeIntact.js';
export { hasStayedOnLoginUrl } from './LoginUrlHelpers.js';
