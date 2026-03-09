import type { TransactionStatuses } from '../../../Transactions.js';
import type { TransactionsColsTypes } from '../BaseBeinleumiGroupBaseTypes.js';
import type { IScrapedTransaction } from './ScrapedTransaction.js';
import type { ITransactionsTr } from './TransactionsTr.js';

export interface IExtractTxnOpts {
  txns: IScrapedTransaction[];
  transactionStatus: TransactionStatuses;
  txnRow: ITransactionsTr;
  transactionsColsTypes: TransactionsColsTypes;
}
