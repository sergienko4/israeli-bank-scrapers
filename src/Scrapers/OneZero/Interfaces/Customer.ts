import type { IPortfolio } from './Portfolio.js';

export interface ICustomer {
  customerId: string;
  portfolios?: IPortfolio[] | null;
}
