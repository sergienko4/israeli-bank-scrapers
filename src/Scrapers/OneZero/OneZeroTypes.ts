export type { Account } from '../../Interfaces/Banks/OneZero/Account';
export type { Category } from '../../Interfaces/Banks/OneZero/Category';
export type { Customer } from '../../Interfaces/Banks/OneZero/Customer';
export type { Movement } from '../../Interfaces/Banks/OneZero/Movement';
export type { OneZeroTransaction } from '../../Interfaces/Banks/OneZero/OneZeroTransaction';
export type { Portfolio } from '../../Interfaces/Banks/OneZero/Portfolio';
export type { QueryPagination } from '../../Interfaces/Banks/OneZero/QueryPagination';
export type { Recurrence } from '../../Interfaces/Banks/OneZero/Recurrence';

export type ScraperSpecificCredentials = { email: string; password: string } & (
  | { otpCodeRetriever: () => Promise<string>; phoneNumber: string }
  | { otpLongTermToken: string }
);
