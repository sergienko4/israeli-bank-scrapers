import type { Moment } from 'moment';
import type { Page } from 'playwright-core';

import type { ScraperOptions } from '../../Base/Interface.js';
import type { ScrapedAccountsWithIndex } from '../BaseIsracardAmexBaseTypes.js';
import type { ICompanyServiceOptions } from './CompanyServiceOptions.js';

export interface IAdditionalInfoOpts {
  scraperOptions: ScraperOptions;
  accountsWithIndex: ScrapedAccountsWithIndex[];
  page: Page;
  options: ICompanyServiceOptions;
  allMonths: Moment[];
}
