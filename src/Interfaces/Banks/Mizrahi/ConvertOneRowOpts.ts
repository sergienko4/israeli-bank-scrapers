import type { ScraperOptions } from '../../../Scrapers/Base/Interface';
import type { ITransactionMoreDetails } from './MoreDetails';
import type { IScrapedTransaction } from './ScrapedTransaction';

export interface IConvertTransactionRowOpts {
  row: IScrapedTransaction;
  getMoreDetails: (r: IScrapedTransaction) => Promise<ITransactionMoreDetails>;
  isPendingIfTodayTransaction: boolean;
  options?: ScraperOptions;
}
