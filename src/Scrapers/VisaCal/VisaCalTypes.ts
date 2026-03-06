import type { AuthModule } from '../../Interfaces/Banks/VisaCal/AuthModule';
import type { CardApiStatus } from '../../Interfaces/Banks/VisaCal/CardApiStatus';
import type { CardPendingTransactionDetails } from '../../Interfaces/Banks/VisaCal/CardPendingTransactionDetails';
import type { CardTransactionDetails } from '../../Interfaces/Banks/VisaCal/CardTransactionDetails';
import type { ScrapedPendingTransaction } from '../../Interfaces/Banks/VisaCal/ScrapedPendingTransaction';
import type { ScrapedTransaction } from '../../Interfaces/Banks/VisaCal/ScrapedTransaction';

export type { ApiContext } from '../../Interfaces/Banks/VisaCal/ApiContext';
export type { AuthModule } from '../../Interfaces/Banks/VisaCal/AuthModule';
export type { CardApiStatus } from '../../Interfaces/Banks/VisaCal/CardApiStatus';
export type { CardInfo } from '../../Interfaces/Banks/VisaCal/CardInfo';
export type { CardLevelFrame } from '../../Interfaces/Banks/VisaCal/CardLevelFrame';
export type { CardPendingTransactionDetails } from '../../Interfaces/Banks/VisaCal/CardPendingTransactionDetails';
export type { CardTransactionDetails } from '../../Interfaces/Banks/VisaCal/CardTransactionDetails';
export type { FramesResponse } from '../../Interfaces/Banks/VisaCal/FramesResponse';
export type {
  InitBankAccount,
  InitCard,
  InitResponse,
  InitUser,
} from '../../Interfaces/Banks/VisaCal/InitResponse';
export type { LoginResponse } from '../../Interfaces/Banks/VisaCal/LoginResponse';
export type { ScrapedPendingTransaction } from '../../Interfaces/Banks/VisaCal/ScrapedPendingTransaction';
export type { ScrapedTransaction } from '../../Interfaces/Banks/VisaCal/ScrapedTransaction';
export type { CurrencySymbol } from './VisaCalBaseTypes';
export { TrnTypeCode } from './VisaCalBaseTypes';

/**
 * Error type from the card transaction details API.
 *
 * @deprecated use CardApiStatus
 */
export type CardTransactionDetailsError = CardApiStatus;

/**
 * Checks whether the given result contains a valid VisaCal auth module.
 *
 * @param result - the unknown API response to test
 * @returns true if the result is an AuthModule with a valid calConnectToken
 */
export function isAuthModule(result: unknown): result is AuthModule {
  if (!result || typeof result !== 'object') return false;
  const candidate = result as Partial<AuthModule>;
  return Boolean(candidate.auth?.calConnectToken?.trim());
}

/**
 * Returns the result as an AuthModule if valid, or undefined otherwise.
 *
 * @param result - the unknown API response to check
 * @returns the AuthModule or undefined
 */
export function authModuleOrUndefined(result: unknown): AuthModule | undefined {
  return isAuthModule(result) ? result : undefined;
}

/**
 * Type guard that returns true if the transaction is a pending (not yet settled) transaction.
 *
 * @param transaction - the scraped transaction to check
 * @returns true if the transaction is a ScrapedPendingTransaction
 */
export function isPending(
  transaction: ScrapedTransaction | ScrapedPendingTransaction,
): transaction is ScrapedPendingTransaction {
  return !('debCrdDate' in transaction); // debCrdDate only appears in completed transactions
}

/**
 * Type guard that returns true if the result is a CardTransactionDetails (not an error status).
 *
 * @param result - the API response to check
 * @returns true if the result contains transaction details
 */
export function isCardTransactionDetails(
  result: CardTransactionDetails | CardApiStatus,
): result is CardTransactionDetails {
  return 'result' in result;
}

/**
 * Type guard that returns true if the result is CardPendingTransactionDetails (not an error status).
 *
 * @param result - the API response to check
 * @returns true if the result contains pending transaction details
 */
export function isCardPendingTransactionDetails(
  result: CardPendingTransactionDetails | CardApiStatus,
): result is CardPendingTransactionDetails {
  return 'result' in result;
}
