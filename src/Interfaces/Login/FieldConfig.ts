import type { SelectorCandidate } from '../../Scrapers/Base/LoginConfigTypes';

/** One form field: which credential key to use + ordered selector candidates.
 *  `selectors` may be empty — wellKnownSelectors provides the fallback in that case. */
export interface IFieldConfig {
  credentialKey: string;
  selectors: SelectorCandidate[];
}
