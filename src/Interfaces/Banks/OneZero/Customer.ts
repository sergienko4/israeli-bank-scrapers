import type { Portfolio } from './Portfolio';

export interface Customer {
  customerId: string;
  portfolios?: Portfolio[] | null;
}
