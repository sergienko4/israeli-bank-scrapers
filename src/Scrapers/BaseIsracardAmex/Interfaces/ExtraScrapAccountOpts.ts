import type { Moment } from 'moment';
import type { Page } from 'playwright';

import type { ScrapedAccountsWithIndex } from '../BaseIsracardAmexBaseTypes.js';
import type { CompanyServiceOptions } from './CompanyServiceOptions.js';

export interface ExtraScrapAccountOpts {
  page: Page;
  options: CompanyServiceOptions;
  accountMap: ScrapedAccountsWithIndex;
  month: Moment;
}
