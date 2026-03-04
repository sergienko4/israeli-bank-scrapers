import type { Frame, Page } from 'playwright';

import type { SelectorCandidate } from '../../Scrapers/Base/LoginConfigTypes';

/** Options for resolving a post-login dashboard selector. */
export interface DashboardFieldOpts {
  pageOrFrame: Page | Frame;
  fieldKey: string;
  bankCandidates: SelectorCandidate[];
  pageUrl: string;
}
