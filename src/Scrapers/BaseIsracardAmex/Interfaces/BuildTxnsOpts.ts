import type { Moment } from 'moment';

import type { ScraperOptions } from '../../Base/Interface.js';
import type { IScrapedAccount } from './ScrapedAccount.js';
import type { IScrapedTransactionData } from './ScrapedTransactionData.js';

export interface IBuildTxnsOpts {
  accounts: IScrapedAccount[];
  dataResult: IScrapedTransactionData;
  options: ScraperOptions;
  startMoment: Moment;
}
