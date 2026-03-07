import type { ICardApiStatus } from './CardApiStatus';
import type { IScrapedPendingTransaction } from './ScrapedPendingTransaction';

export interface ICardPendingTransactionDetails extends ICardApiStatus {
  result: {
    cardsList: {
      cardUniqueID: string;
      authDetalisList: IScrapedPendingTransaction[];
    }[];
  };
  statusCode: 1;
  statusDescription: string;
  statusTitle: string;
}
