import type { Moment } from 'moment';
import type { Page } from 'playwright';

import type { ScraperOptions } from '../../Base/Interface.js';
import type { ScrapedAccountsWithIndex } from '../BaseIsracardAmexBaseTypes.js';
import type { CompanyServiceOptions } from './CompanyServiceOptions.js';

export interface AdditionalInfoOpts {
  scraperOptions: ScraperOptions;
  accountsWithIndex: ScrapedAccountsWithIndex[];
  page: Page;
  options: CompanyServiceOptions;
  allMonths: Moment[];
}
