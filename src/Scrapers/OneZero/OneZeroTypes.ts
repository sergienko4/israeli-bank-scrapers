export type { IAccount } from './Interfaces/Account.js';
export type { ICategory } from './Interfaces/Category.js';
export type { ICustomer } from './Interfaces/Customer.js';
export type { IMovement } from './Interfaces/Movement.js';
export type { IOneZeroTransaction } from './Interfaces/OneZeroTransaction.js';
export type { IPortfolio } from './Interfaces/Portfolio.js';
export type { IQueryPagination } from './Interfaces/QueryPagination.js';
export type { IRecurrence } from './Interfaces/Recurrence.js';

export type IScraperSpecificCredentials = { email: string; password: string } & (
  | { otpCodeRetriever: () => Promise<string>; phoneNumber: string }
  | { otpLongTermToken: string }
);
