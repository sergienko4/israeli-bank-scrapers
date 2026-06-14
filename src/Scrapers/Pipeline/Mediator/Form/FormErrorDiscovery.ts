/**
 * FORM error-discovery facade. Thin re-export over the
 * ErrorDiscovery/ sub-modules.
 *
 * <p>Phase 12d split: see
 * ErrorDiscovery/{ErrorDiscoveryTypes,ErrorDiscoveryScan,ErrorDiscoveryProbe}.ts
 * for the implementations.
 *
 * <p>Layer 1 — discoverFormErrors: dynamic DOM structural scan.
 *   Finds mat-error, [aria-invalid], [role=alert], etc. — works for any text.
 *   Banks provide ZERO knowledge — the scanner reads whatever the DOM shows.
 *
 * <p>Layer 2 — checkFrameForErrors: WellKnown text scan.
 *   Fallback for banks that don't use standard error markup.
 *
 * <p>Both are mediator handlers — called by IElementMediator.discoverErrors().
 * LoginSteps NEVER imports these directly — only through the mediator.
 */

export { checkFrameForErrors } from './ErrorDiscovery/ErrorDiscoveryProbe.js';
export { discoverFormErrors } from './ErrorDiscovery/ErrorDiscoveryScan.js';
export {
  type FormErrorKind,
  type IFormError,
  type IFormErrorScanResult,
  NO_ERRORS,
} from './ErrorDiscovery/ErrorDiscoveryTypes.js';
