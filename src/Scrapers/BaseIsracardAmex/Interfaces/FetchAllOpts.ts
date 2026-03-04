import type { Moment } from 'moment';
import type { Page } from 'playwright';

import type { ScraperOptions } from '../../Base/Interface';
import type { CompanyServiceOptions } from './CompanyServiceOptions';

export interface FetchAllOpts {
  page: Page;
  options: ScraperOptions;
  companyServiceOptions: CompanyServiceOptions;
  startMoment: Moment;
}
