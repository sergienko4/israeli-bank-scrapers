import type { Moment } from 'moment';
import type { Page } from 'playwright';

import type { ITransaction } from '../../../Transactions';
import type { ICompanyServiceOptions } from './CompanyServiceOptions';

export interface IExtraScrapeTransactionOpts {
  page: Page;
  options: ICompanyServiceOptions;
  month: Moment;
  accountIndex: number;
  transaction: ITransaction;
}
