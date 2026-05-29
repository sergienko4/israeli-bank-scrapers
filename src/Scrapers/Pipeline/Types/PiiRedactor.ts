/**
 * PiiRedactor — single source of truth for PII redaction across every
 * persisted log destination of this package.
 *
 * Phase 6 status: this file is now a thin re-export shim over the
 * per-category modules under `./PiiRedactor/`. The Facade hosts the
 * unified `redact()`, the Pino `createCensorFn()`, and the `classifyKey`
 * router; per-category strategies live in their own modules. Phase 6
 * commit 6 will collapse this shim further once downstream callers
 * have migrated to the per-module imports.
 *
 * Destinations covered (no bypass paths):
 *  - Pino terminal stream (pino-pretty)         via createCensorFn()
 *  - Pino file stream (pipeline.log)            via createCensorFn()
 *  - NetworkDiscovery.dumpResponseBody          via redactJsonBody()
 *  - FixtureCapture HTML / metadata writers     via redactHtml() /
 *                                               redactJsonBody()
 *  - Test result formatter                      via per-strategy exports
 */

export { redactAccount } from './PiiRedactor/Account.js';
export { redactAmount } from './PiiRedactor/Amount.js';
export { redactCookie, redactOtp, redactToken } from './PiiRedactor/AuthCredentials.js';
export { redactCard } from './PiiRedactor/Card.js';
export { redactErrorMessage, redactSensitiveEnum } from './PiiRedactor/ErrorLog.js';
export type { CensorFn } from './PiiRedactor/Facade.js';
export { classifyKey, createCensorFn, redact } from './PiiRedactor/Facade.js';
export { redactHtml } from './PiiRedactor/Html.js';
export { redactIsraeliId } from './PiiRedactor/IsraeliId.js';
export { redactJsonBody } from './PiiRedactor/JsonBody.js';
export { redactMerchant } from './PiiRedactor/Merchant.js';
export { redactName } from './PiiRedactor/Name.js';
export { redactPhone } from './PiiRedactor/Phone.js';
export type { JsonValue, PiiCategory } from './PiiRedactor/Types.js';
export { REDACTED_HINT, REDACTION_ERROR_HINT } from './PiiRedactor/Types.js';
export { redactUrl, redactUrlFull } from './PiiRedactor/Url.js';
