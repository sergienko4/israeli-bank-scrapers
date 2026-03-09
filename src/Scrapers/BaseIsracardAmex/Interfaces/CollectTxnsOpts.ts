import type { Moment } from 'moment';

import type { ScraperOptions } from '../../Base/Interface.js';
import type { IScrapedAccount } from './ScrapedAccount.js';
import type { IScrapedCurrentCardTransactions } from './ScrapedCurrentCardTransactions.js';

export interface ICollectTxnsOpts {
  txnGroups: IScrapedCurrentCardTransactions[];
  account: IScrapedAccount;
  options: ScraperOptions;
  startMoment: Moment;
}
