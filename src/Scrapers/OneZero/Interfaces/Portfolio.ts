import type { Account } from './Account.js';

export interface Portfolio {
  accounts: Account[];
  portfolioId: string;
  portfolioNum: string;
}
