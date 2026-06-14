/**
 * LoginFormActions — fill credentials + click submit, in two flavors:
 *   - classic (mediator-driven, password-first field resolution)
 *   - discovery-based (sealed executor consuming PRE-resolved targets)
 *
 * <p>Phase 12d split: this file is now a thin façade re-exporting the
 * three sub-modules under {@link ./Actions/}.
 * @see ./Actions/ActionsTypes.ts     — shared types + helpers
 * @see ./Actions/ActionsFill.ts      — classic fill path (fillAllFields, fillAndSubmit)
 * @see ./Actions/ActionsDiscovery.ts — discovery-based fill path (fillFromDiscovery)
 */

export { fillFromDiscovery } from './Actions/ActionsDiscovery.js';
export { fillAllFields, fillAndSubmit } from './Actions/ActionsFill.js';
export type {
  IFillFromDiscoveryArgs,
  ISubmitResult,
  SubmitMethod,
} from './Actions/ActionsTypes.js';
