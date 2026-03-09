import type { ICardApiStatus } from './CardApiStatus.js';
import type { IScrapedPendingTransaction } from './ScrapedPendingTransaction.js';

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
