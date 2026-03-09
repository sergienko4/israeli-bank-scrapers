import { jest } from '@jest/globals';

export interface IOneZeroMovement {
  movementId: string;
  valueDate: string;
  movementTimestamp: string;
  movementAmount: string;
  movementCurrency: string;
  creditDebit: string;
  description: string;
  runningBalance: string;
  transaction: null | {
    enrichment?: {
      recurrences?: { isRecurrent: boolean; dataSource?: string }[] | null;
    } | null;
  };
  bankCurrencyAmount?: string;
  conversionRate?: string;
  isReversed?: boolean;
  movementReversedId?: string | null;
  movementType?: string;
  portfolioId?: string;
  accountId?: string;
}

/**
 * Generate a recent ISO date string from one month ago.
 * @returns ISO date string.
 */
export function recentDate(): string {
  const date = new Date();
  date.setMonth(date.getMonth() - 1);
  return date.toISOString();
}

/**
 * Build a movement fixture for OneZero tests.
 * @param overrides - Partial movement fields to override.
 * @returns A complete OneZero movement.
 */
export function movement(overrides: Partial<IOneZeroMovement> = {}): IOneZeroMovement {
  const timestamp = recentDate();
  return {
    movementId: 'mov-001',
    valueDate: timestamp.slice(0, 10),
    movementTimestamp: timestamp,
    movementAmount: '100',
    movementCurrency: 'ILS',
    creditDebit: 'DEBIT',
    description: 'Test Payment',
    runningBalance: '5000',
    transaction: null,
    ...overrides,
  };
}

export const LONG_TERM_CREDS = {
  email: 'test@example.com',
  password: 'pass123',
  otpLongTermToken: 'valid-token',
};

export const OTP_CALLBACK_CREDS = {
  email: 'test@example.com',
  password: 'pass123',
  otpCodeRetriever: jest.fn().mockResolvedValue('123456'),
  phoneNumber: '+972501234567',
};
