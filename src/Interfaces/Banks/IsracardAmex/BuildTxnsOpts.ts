import type { Moment } from 'moment';

import type { ScraperOptions } from '../../../Scrapers/Base/Interface';
import type { IScrapedAccount } from './ScrapedAccount';
import type { IScrapedTransactionData } from './ScrapedTransactionData';

export interface IBuildTransactionsOpts {
  accounts: IScrapedAccount[];
  dataResult: IScrapedTransactionData;
  options: ScraperOptions;
  startMoment: Moment;
}
