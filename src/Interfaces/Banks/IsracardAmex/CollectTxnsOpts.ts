import type { Moment } from 'moment';

import type { ScraperOptions } from '../../../Scrapers/Base/Interface';
import type { IScrapedAccount } from './ScrapedAccount';
import type { IScrapedCurrentCardTransactions } from './ScrapedCurrentCardTransactions';

export interface ICollectTransactionsOpts {
  txnGroups: IScrapedCurrentCardTransactions[];
  account: IScrapedAccount;
  options: ScraperOptions;
  startMoment: Moment;
}
