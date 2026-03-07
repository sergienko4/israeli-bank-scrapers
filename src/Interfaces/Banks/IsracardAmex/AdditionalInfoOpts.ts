import type { Moment } from 'moment';
import type { Page } from 'playwright';

import type { ScraperOptions } from '../../../Scrapers/Base/Interface';
import type { ScrapedAccountsWithIndex } from '../../../Scrapers/BaseIsracardAmex/BaseIsracardAmexBaseTypes';
import type { ICompanyServiceOptions } from './CompanyServiceOptions';

export interface IAdditionalInfoOpts {
  scraperOptions: ScraperOptions;
  accountsWithIndex: ScrapedAccountsWithIndex[];
  page: Page;
  options: ICompanyServiceOptions;
  allMonths: Moment[];
}
