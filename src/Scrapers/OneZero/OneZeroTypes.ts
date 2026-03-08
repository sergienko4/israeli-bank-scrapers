export type { Account } from './Interfaces/Account.js';
export type { Category } from './Interfaces/Category.js';
export type { Customer } from './Interfaces/Customer.js';
export type { Movement } from './Interfaces/Movement.js';
export type { OneZeroTransaction } from './Interfaces/OneZeroTransaction.js';
export type { Portfolio } from './Interfaces/Portfolio.js';
export type { QueryPagination } from './Interfaces/QueryPagination.js';
export type { Recurrence } from './Interfaces/Recurrence.js';

export type ScraperSpecificCredentials = { email: string; password: string } & (
  | { otpCodeRetriever: () => Promise<string>; phoneNumber: string }
  | { otpLongTermToken: string }
);
