import type { Moment } from 'moment';
import type { Page } from 'playwright';

import type { ScrapedAccountsWithIndex } from '../../../Scrapers/BaseIsracardAmex/BaseIsracardAmexBaseTypes';
import type { CompanyServiceOptions } from './CompanyServiceOptions';

export interface ExtraScrapAccountOpts {
  page: Page;
  options: CompanyServiceOptions;
  accountMap: ScrapedAccountsWithIndex;
  month: Moment;
}
