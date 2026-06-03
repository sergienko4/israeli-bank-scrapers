/**
 * HOME phase Mediator actions — barrel that composes the four
 * responsibility siblings (Validate / Signal / Modal / Navigate) into
 * the single import surface consumed by Home phase orchestrators.
 *
 * Phase orchestrates ONLY. All logic lives in the siblings.
 *
 * Rule #20: PRE is passive (HomeResolver.ts). ACTION is the Executioner.
 * SRP rule (Phase 6): ACTION clicks ONLY the PRE-resolved
 * `triggerTarget` (identity selector). No `text=<value>` re-resolution,
 * no tier-cascade onto a different DOM element, no href-scan rescue.
 */

export { executeModalClick, tryClickLoginLink, waitForAnyLoginLink } from './HomeActions.Modal.js';
export { didReallyNavigate, executeHomeNavigation } from './HomeActions.Navigate.js';
export { executeStoreLoginSignal } from './HomeActions.Signal.js';
export { executeValidateLoginArea } from './HomeActions.Validate.js';
