import type { TransactionStatuses } from '../../../Transactions.js';
import type { TransactionsColsTypes } from '../BaseBeinleumiGroupBaseTypes.js';
import type { ScrapedTransaction } from './ScrapedTransaction.js';
import type { TransactionsTr } from './TransactionsTr.js';

export interface ExtractTxnOpts {
  txns: ScrapedTransaction[];
  transactionStatus: TransactionStatuses;
  txnRow: TransactionsTr;
  transactionsColsTypes: TransactionsColsTypes;
}
