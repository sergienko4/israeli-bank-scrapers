import type { Frame, Page } from 'playwright';

import type { SelectorCandidate } from '../../Scrapers/Base/LoginConfigTypes';
import type { IFieldConfig } from '../Login/FieldConfig';

/** All inputs needed to resolve a single login field. */
export interface IResolveAllOpts {
  pageOrFrame: Page | Frame;
  field: IFieldConfig;
  pageUrl: string;
  bankCandidates: SelectorCandidate[];
  wellKnownCandidates: SelectorCandidate[];
}
