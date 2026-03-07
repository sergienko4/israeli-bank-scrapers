import type { Moment } from 'moment';
import type { Page } from 'playwright';

import type { ScrapedAccountsWithIndex } from '../../../Scrapers/BaseIsracardAmex/BaseIsracardAmexBaseTypes';
import type { ICompanyServiceOptions } from './CompanyServiceOptions';

export interface IExtraScrapeAccountOpts {
  page: Page;
  options: ICompanyServiceOptions;
  accountMap: ScrapedAccountsWithIndex;
  month: Moment;
}
