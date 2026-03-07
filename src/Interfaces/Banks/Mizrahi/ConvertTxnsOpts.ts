import type { ScraperOptions } from '../../../Scrapers/Base/Interface';
import type { ITransactionMoreDetails } from './MoreDetails';
import type { IScrapedTransaction } from './ScrapedTransaction';

export interface IConvertTransactionsOpts {
  txns: IScrapedTransaction[];
  getMoreDetails: (row: IScrapedTransaction) => Promise<ITransactionMoreDetails>;
  isPendingIfTodayTransaction?: boolean;
  options?: ScraperOptions;
}
