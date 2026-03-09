import type { IAccount } from './Account.js';

export interface IPortfolio {
  accounts: IAccount[];
  portfolioId: string;
  portfolioNum: string;
}
