import type { Moment } from 'moment';
import type { Page } from 'playwright-core';

import type { ScraperOptions } from '../../Base/Interface.js';
import type { ICompanyServiceOptions } from './CompanyServiceOptions.js';

export interface IFetchAllOpts {
  page: Page;
  options: ScraperOptions;
  companyServiceOptions: ICompanyServiceOptions;
  startMoment: Moment;
}
