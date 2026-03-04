import type { Account } from './Account';

export interface Portfolio {
  accounts: Account[];
  portfolioId: string;
  portfolioNum: string;
}
