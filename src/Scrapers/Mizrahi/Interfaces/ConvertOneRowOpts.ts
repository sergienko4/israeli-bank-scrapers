import type { ScraperOptions } from '../../Base/Interface';
import type { MoreDetails } from './MoreDetails';
import type { ScrapedTransaction } from './ScrapedTransaction';

export interface ConvertOneRowOpts {
  row: ScrapedTransaction;
  getMoreDetails: (r: ScrapedTransaction) => Promise<MoreDetails>;
  isPendingIfTodayTransaction: boolean;
  options?: ScraperOptions;
}
