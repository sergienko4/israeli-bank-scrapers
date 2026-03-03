import type { TransactionStatuses } from '../../../Transactions';
import type { TransactionsColsTypes } from '../BaseBeinleumiGroupBaseTypes';
import type { ScrapedTransaction } from './ScrapedTransaction';
import type { TransactionsTr } from './TransactionsTr';

export interface ExtractTxnOpts {
  txns: ScrapedTransaction[];
  transactionStatus: TransactionStatuses;
  txnRow: TransactionsTr;
  transactionsColsTypes: TransactionsColsTypes;
}
