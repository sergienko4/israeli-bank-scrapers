import type { Moment } from 'moment';

import type { ScraperOptions } from '../../Base/Interface.js';
import type { ScrapedAccount } from './ScrapedAccount.js';
import type { ScrapedTransactionData } from './ScrapedTransactionData.js';

export interface BuildTxnsOpts {
  accounts: ScrapedAccount[];
  dataResult: ScrapedTransactionData;
  options: ScraperOptions;
  startMoment: Moment;
}
