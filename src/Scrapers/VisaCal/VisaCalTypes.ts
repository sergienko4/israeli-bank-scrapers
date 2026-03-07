import type { IAuthModule } from '../../Interfaces/Banks/VisaCal/AuthModule';
import type { ICardApiStatus } from '../../Interfaces/Banks/VisaCal/CardApiStatus';
import type { ICardPendingTransactionDetails } from '../../Interfaces/Banks/VisaCal/CardPendingTransactionDetails';
import type { ICardTransactionDetails } from '../../Interfaces/Banks/VisaCal/CardTransactionDetails';
import type { IScrapedPendingTransaction } from '../../Interfaces/Banks/VisaCal/ScrapedPendingTransaction';
import type { IScrapedTransaction } from '../../Interfaces/Banks/VisaCal/ScrapedTransaction';
import type { FoundResult } from '../../Interfaces/Common/FoundResult';

export type { IApiContext } from '../../Interfaces/Banks/VisaCal/ApiContext';
export type { IAuthModule } from '../../Interfaces/Banks/VisaCal/AuthModule';
export type { ICardApiStatus } from '../../Interfaces/Banks/VisaCal/CardApiStatus';
export type { ICardInfo } from '../../Interfaces/Banks/VisaCal/CardInfo';
export type { ICardLevelFrame } from '../../Interfaces/Banks/VisaCal/CardLevelFrame';
export type { ICardPendingTransactionDetails } from '../../Interfaces/Banks/VisaCal/CardPendingTransactionDetails';
export type { ICardTransactionDetails } from '../../Interfaces/Banks/VisaCal/CardTransactionDetails';
export type { IFramesResponse } from '../../Interfaces/Banks/VisaCal/FramesResponse';
export type {
  IInitBankAccount,
  IInitCard,
  IInitResponse,
  IInitUser,
} from '../../Interfaces/Banks/VisaCal/InitResponse';
export type { ILoginResponse } from '../../Interfaces/Banks/VisaCal/LoginResponse';
export type { IScrapedPendingTransaction } from '../../Interfaces/Banks/VisaCal/ScrapedPendingTransaction';
export type { IScrapedTransaction } from '../../Interfaces/Banks/VisaCal/ScrapedTransaction';
export type { CurrencySymbol } from './VisaCalBaseTypes';
export { TrnTypeCode } from './VisaCalBaseTypes';

/**
 * Error type from the card transaction details API.
 *
 * @deprecated use ICardApiStatus
 */
export type CardTransactionDetailsError = ICardApiStatus;

/**
 * Checks whether the given result contains a valid VisaCal auth module.
 *
 * @param result - the unknown API response to test
 * @returns true if the result is an IAuthModule with a valid calConnectToken
 */
export function isAuthModule(result: unknown): result is IAuthModule {
  if (!result || typeof result !== 'object') return false;
  const candidate = result as Partial<IAuthModule>;
  return Boolean(candidate.auth?.calConnectToken?.trim());
}

/**
 * Returns the result as a FoundResult<IAuthModule> if valid, or isFound=false otherwise.
 *
 * @param result - the unknown API response to check
 * @returns FoundResult wrapping the IAuthModule, or isFound=false if invalid
 */
export function authModuleOrUndefined(result: unknown): FoundResult<IAuthModule> {
  return isAuthModule(result) ? { isFound: true, value: result } : { isFound: false };
}

/**
 * Type guard that returns true if the transaction is a pending (not yet settled) transaction.
 *
 * @param transaction - the scraped transaction to check
 * @returns true if the transaction is a IScrapedPendingTransaction
 */
export function isPending(
  transaction: IScrapedTransaction | IScrapedPendingTransaction,
): transaction is IScrapedPendingTransaction {
  return !('debCrdDate' in transaction); // debCrdDate only appears in completed transactions
}

/**
 * Type guard that returns true if the result is a ICardTransactionDetails (not an error status).
 *
 * @param result - the API response to check
 * @returns true if the result contains transaction details
 */
export function isCardTransactionDetails(
  result: ICardTransactionDetails | ICardApiStatus,
): result is ICardTransactionDetails {
  return 'result' in result;
}

/**
 * Type guard that returns true if the result is ICardPendingTransactionDetails (not an error status).
 *
 * @param result - the API response to check
 * @returns true if the result contains pending transaction details
 */
export function isCardPendingTransactionDetails(
  result: ICardPendingTransactionDetails | ICardApiStatus,
): result is ICardPendingTransactionDetails {
  return 'result' in result;
}
