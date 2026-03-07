import type { TransactionsColsTypes } from '../../../Scrapers/BaseBeinleumiGroup/BaseBeinleumiGroupBaseTypes';
import type { TransactionStatuses } from '../../../Transactions';
import type { IScrapedTransaction } from './ScrapedTransaction';
import type { ITransactionTableRow } from './TransactionsTr';

export interface IExtractTransactionOpts {
  txns: IScrapedTransaction[];
  transactionStatus: TransactionStatuses;
  txnRow: ITransactionTableRow;
  transactionsColsTypes: TransactionsColsTypes;
}
