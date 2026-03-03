import type { Moment } from 'moment';

import type { ScraperOptions } from '../../Base/Interface';
import type { ScrapedAccount } from './ScrapedAccount';
import type { ScrapedTransactionData } from './ScrapedTransactionData';

export interface BuildTxnsOpts {
  accounts: ScrapedAccount[];
  dataResult: ScrapedTransactionData;
  options: ScraperOptions;
  startMoment: Moment;
}
