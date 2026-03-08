import type { Moment } from 'moment';
import type { Page } from 'playwright';

import type { ScraperOptions } from '../../Base/Interface.js';
import type { CompanyServiceOptions } from './CompanyServiceOptions.js';

export interface FetchAllOpts {
  page: Page;
  options: ScraperOptions;
  companyServiceOptions: CompanyServiceOptions;
  startMoment: Moment;
}
