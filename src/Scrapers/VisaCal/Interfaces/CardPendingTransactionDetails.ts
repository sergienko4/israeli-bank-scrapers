import type { CardApiStatus } from './CardApiStatus.js';
import type { ScrapedPendingTransaction } from './ScrapedPendingTransaction.js';

export interface CardPendingTransactionDetails extends CardApiStatus {
  result: {
    cardsList: {
      cardUniqueID: string;
      authDetalisList: ScrapedPendingTransaction[];
    }[];
  };
  statusCode: 1;
  statusDescription: string;
  statusTitle: string;
}
