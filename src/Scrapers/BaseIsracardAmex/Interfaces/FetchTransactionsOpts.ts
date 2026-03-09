import type { Moment } from 'moment';
import type { Page } from 'playwright';

import type { ScraperOptions } from '../../Base/Interface.js';
import type { ICompanyServiceOptions } from './CompanyServiceOptions.js';

export interface IFetchTransactionsOpts {
  page: Page;
  options: ScraperOptions;
  companyServiceOptions: ICompanyServiceOptions;
  startMoment: Moment;
  monthMoment: Moment;
}
