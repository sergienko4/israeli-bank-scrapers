import type { IPortfolio } from './Portfolio';

export interface ICustomer {
  customerId: string;
  portfolios?: IPortfolio[] | null;
}
