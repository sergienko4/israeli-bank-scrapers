import type { Frame, Page } from 'playwright';

import type { SelectorCandidate } from '../../Scrapers/Base/LoginConfigTypes';
import type { FieldConfig } from '../Login/FieldConfig';

/** All inputs needed to resolve a single login field. */
export interface ResolveAllOpts {
  pageOrFrame: Page | Frame;
  field: FieldConfig;
  pageUrl: string;
  bankCandidates: SelectorCandidate[];
  wellKnownCandidates: SelectorCandidate[];
}
