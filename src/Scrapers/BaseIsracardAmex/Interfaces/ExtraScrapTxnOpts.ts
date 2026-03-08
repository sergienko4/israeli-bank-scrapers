import type { Moment } from 'moment';
import type { Page } from 'playwright';

import type { Transaction } from '../../../Transactions.js';
import type { CompanyServiceOptions } from './CompanyServiceOptions.js';

export interface ExtraScrapTxnOpts {
  page: Page;
  options: CompanyServiceOptions;
  month: Moment;
  accountIndex: number;
  transaction: Transaction;
}
