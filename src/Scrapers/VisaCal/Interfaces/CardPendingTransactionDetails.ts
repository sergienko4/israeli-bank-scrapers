import type { CardApiStatus } from './CardApiStatus';
import type { ScrapedPendingTransaction } from './ScrapedPendingTransaction';

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
