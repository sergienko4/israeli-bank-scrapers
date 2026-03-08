import type { Moment } from 'moment';

import type { ScraperOptions } from '../../Base/Interface.js';
import type { ScrapedAccount } from './ScrapedAccount.js';
import type { ScrapedCurrentCardTransactions } from './ScrapedCurrentCardTransactions.js';

export interface CollectTxnsOpts {
  txnGroups: ScrapedCurrentCardTransactions[];
  account: ScrapedAccount;
  options: ScraperOptions;
  startMoment: Moment;
}
