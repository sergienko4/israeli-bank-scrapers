export type { IAccount } from '../../Interfaces/Banks/OneZero/Account';
export type { ICategory } from '../../Interfaces/Banks/OneZero/Category';
export type { ICustomer } from '../../Interfaces/Banks/OneZero/Customer';
export type { IMovement } from '../../Interfaces/Banks/OneZero/Movement';
export type { IOneZeroTransaction } from '../../Interfaces/Banks/OneZero/OneZeroTransaction';
export type { IPortfolio } from '../../Interfaces/Banks/OneZero/Portfolio';
export type { IQueryPagination } from '../../Interfaces/Banks/OneZero/QueryPagination';
export type { IRecurrence } from '../../Interfaces/Banks/OneZero/Recurrence';

export type IScraperSpecificCredentials = { email: string; password: string } & (
  | { otpCodeRetriever: () => Promise<string>; phoneNumber: string }
  | { otpLongTermToken: string }
);
