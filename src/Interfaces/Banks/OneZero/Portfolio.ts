import type { IAccount } from './Account';

export interface IPortfolio {
  accounts: IAccount[];
  portfolioId: string;
  portfolioNum: string;
}
