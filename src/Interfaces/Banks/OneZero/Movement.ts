import type { IOneZeroTransaction } from './OneZeroTransaction';

export interface IMovement {
  accountId: string;
  bankCurrencyAmount: string;
  bookingDate: string;
  conversionRate: string;
  creditDebit: string;
  description: string;
  isReversed: boolean;
  movementAmount: string;
  movementCurrency: string;
  movementId: string;
  movementReversedId?: string | null;
  movementTimestamp: string;
  movementType: string;
  portfolioId: string;
  runningBalance: string;
  transaction?: IOneZeroTransaction | null;
  valueDate: string;
}
