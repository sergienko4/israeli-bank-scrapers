import type { ScraperOptions } from '../../Base/Interface.js';
import type { IMoreDetails } from './MoreDetails.js';
import type { IScrapedTransaction } from './ScrapedTransaction.js';

export interface IConvertTxnsOpts {
  txns: IScrapedTransaction[];
  getMoreDetails: (row: IScrapedTransaction) => Promise<IMoreDetails>;
  isPendingIfTodayTransaction?: boolean;
  options?: ScraperOptions;
}
