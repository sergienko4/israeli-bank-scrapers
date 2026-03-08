import type { Portfolio } from './Portfolio.js';

export interface Customer {
  customerId: string;
  portfolios?: Portfolio[] | null;
}
