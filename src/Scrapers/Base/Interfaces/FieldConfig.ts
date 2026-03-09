import type { SelectorCandidate } from '../LoginConfigTypes.js';

/** One form field: which credential key to use + ordered selector candidates.
 *  `selectors` may be empty — wellKnownSelectors provides the fallback in that case. */
export interface IFieldConfig {
  credentialKey: string;
  selectors: SelectorCandidate[];
}
