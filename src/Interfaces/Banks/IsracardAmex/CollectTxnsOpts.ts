import type { Moment } from 'moment';

import type { ScraperOptions } from '../../../Scrapers/Base/Interface';
import type { ScrapedAccount } from './ScrapedAccount';
import type { ScrapedCurrentCardTransactions } from './ScrapedCurrentCardTransactions';

export interface CollectTxnsOpts {
  txnGroups: ScrapedCurrentCardTransactions[];
  account: ScrapedAccount;
  options: ScraperOptions;
  startMoment: Moment;
}
