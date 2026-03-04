import type { TransactionsColsTypes } from '../../../Scrapers/BaseBeinleumiGroup/BaseBeinleumiGroupBaseTypes';
import type { TransactionStatuses } from '../../../Transactions';
import type { ScrapedTransaction } from './ScrapedTransaction';
import type { TransactionsTr } from './TransactionsTr';

export interface ExtractTxnOpts {
  txns: ScrapedTransaction[];
  transactionStatus: TransactionStatuses;
  txnRow: TransactionsTr;
  transactionsColsTypes: TransactionsColsTypes;
}
