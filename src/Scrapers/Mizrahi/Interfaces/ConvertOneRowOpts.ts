import type { ScraperOptions } from '../../Base/Interface.js';
import type { IMoreDetails } from './MoreDetails.js';
import type { IScrapedTransaction } from './ScrapedTransaction.js';

export interface IConvertOneRowOpts {
  row: IScrapedTransaction;
  getMoreDetails: (r: IScrapedTransaction) => Promise<IMoreDetails>;
  isPendingIfTodayTransaction: boolean;
  options?: ScraperOptions;
}
