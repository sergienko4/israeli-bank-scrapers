import type { Moment } from 'moment';
import type { Page } from 'playwright';

import type { ScraperOptions } from '../../Base/Interface';
import type { ScrapedAccountsWithIndex } from '../BaseIsracardAmexBaseTypes';
import type { CompanyServiceOptions } from './CompanyServiceOptions';

export interface AdditionalInfoOpts {
  scraperOptions: ScraperOptions;
  accountsWithIndex: ScrapedAccountsWithIndex[];
  page: Page;
  options: CompanyServiceOptions;
  allMonths: Moment[];
}
