import type { Moment } from 'moment';
import type { Page } from 'playwright-core';

import type { ITransaction } from '../../../Transactions.js';
import type { ICompanyServiceOptions } from './CompanyServiceOptions.js';

export interface IExtraScrapTxnOpts {
  page: Page;
  options: ICompanyServiceOptions;
  month: Moment;
  accountIndex: number;
  transaction: ITransaction;
}
