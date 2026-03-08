import type { ScraperOptions } from '../../Base/Interface.js';
import type { MoreDetails } from './MoreDetails.js';
import type { ScrapedTransaction } from './ScrapedTransaction.js';

export interface ConvertOneRowOpts {
  row: ScrapedTransaction;
  getMoreDetails: (r: ScrapedTransaction) => Promise<MoreDetails>;
  isPendingIfTodayTransaction: boolean;
  options?: ScraperOptions;
}
