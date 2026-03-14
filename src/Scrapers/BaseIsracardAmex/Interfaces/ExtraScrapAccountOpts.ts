import type { Moment } from 'moment';
import type { Page } from 'playwright-core';

import type { ScrapedAccountsWithIndex } from '../BaseIsracardAmexBaseTypes.js';
import type { ICompanyServiceOptions } from './CompanyServiceOptions.js';

export interface IExtraScrapAccountOpts {
  page: Page;
  options: ICompanyServiceOptions;
  accountMap: ScrapedAccountsWithIndex;
  month: Moment;
}
