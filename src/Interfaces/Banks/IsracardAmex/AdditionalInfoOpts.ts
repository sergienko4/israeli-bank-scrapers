import type { Moment } from 'moment';
import type { Page } from 'playwright';

import type { ScraperOptions } from '../../../Scrapers/Base/Interface';
import type { ScrapedAccountsWithIndex } from '../../../Scrapers/BaseIsracardAmex/BaseIsracardAmexBaseTypes';
import type { CompanyServiceOptions } from './CompanyServiceOptions';

export interface AdditionalInfoOpts {
  scraperOptions: ScraperOptions;
  accountsWithIndex: ScrapedAccountsWithIndex[];
  page: Page;
  options: CompanyServiceOptions;
  allMonths: Moment[];
}
