import type { Moment } from 'moment';
import type { Page } from 'playwright';

import type { ScraperOptions } from '../../../Scrapers/Base/Interface';
import type { ICompanyServiceOptions } from './CompanyServiceOptions';

export interface IFetchTransactionsOpts {
  page: Page;
  options: ScraperOptions;
  companyServiceOptions: ICompanyServiceOptions;
  startMoment: Moment;
  monthMoment: Moment;
}
