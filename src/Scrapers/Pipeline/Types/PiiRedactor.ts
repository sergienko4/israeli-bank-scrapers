/**
 * PiiRedactor — tombstone re-export shim.
 *
 * The real implementations live in the per-category modules under
 * `./PiiRedactor/`. This module exists only to preserve the legacy
 * import path (`./PiiRedactor.js`) for downstream callers. Add new
 * strategies in their own module under `./PiiRedactor/`; do NOT add
 * implementation code here.
 *
 * Architecture: see `./PiiRedactor/Facade.ts` for the unified
 * `redact()` entry point and the Pino `createCensorFn()` registry.
 *
 * Spec: pipeline-decoupling-master-2026-05-28 / phase-6.
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
