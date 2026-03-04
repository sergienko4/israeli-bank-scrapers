export type { Account } from './Interfaces/Account';
export type { Category } from './Interfaces/Category';
export type { Customer } from './Interfaces/Customer';
export type { Movement } from './Interfaces/Movement';
export type { OneZeroTransaction } from './Interfaces/OneZeroTransaction';
export type { Portfolio } from './Interfaces/Portfolio';
export type { QueryPagination } from './Interfaces/QueryPagination';
export type { Recurrence } from './Interfaces/Recurrence';

export type ScraperSpecificCredentials = { email: string; password: string } & (
  | { otpCodeRetriever: () => Promise<string>; phoneNumber: string }
  | { otpLongTermToken: string }
);
