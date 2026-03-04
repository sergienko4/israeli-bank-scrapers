import type { ScraperOptions } from '../../Base/Interface';
import type { MoreDetails } from './MoreDetails';
import type { ScrapedTransaction } from './ScrapedTransaction';

export interface ConvertTxnsOpts {
  txns: ScrapedTransaction[];
  getMoreDetails: (row: ScrapedTransaction) => Promise<MoreDetails>;
  isPendingIfTodayTransaction?: boolean;
  options?: ScraperOptions;
}
