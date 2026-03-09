import type { IAuthModule } from './Interfaces/AuthModule.js';
import type { ICardApiStatus } from './Interfaces/CardApiStatus.js';
import type { ICardPendingTransactionDetails } from './Interfaces/CardPendingTransactionDetails.js';
import type { ICardTransactionDetails } from './Interfaces/CardTransactionDetails.js';
import type { IScrapedPendingTransaction } from './Interfaces/ScrapedPendingTransaction.js';
import type { IScrapedTransaction } from './Interfaces/ScrapedTransaction.js';

export type { IApiContext } from './Interfaces/ApiContext.js';
export type { IAuthModule } from './Interfaces/AuthModule.js';
export type { ICardApiStatus } from './Interfaces/CardApiStatus.js';
export type { ICardInfo } from './Interfaces/CardInfo.js';
export type { ICardLevelFrame } from './Interfaces/CardLevelFrame.js';
export type { ICardPendingTransactionDetails } from './Interfaces/CardPendingTransactionDetails.js';
export type { ICardTransactionDetails } from './Interfaces/CardTransactionDetails.js';
export type { IFramesResponse } from './Interfaces/FramesResponse.js';
export type { IInitResponse } from './Interfaces/InitResponse.js';
export type { ILoginResponse } from './Interfaces/LoginResponse.js';
export type { IScrapedPendingTransaction } from './Interfaces/ScrapedPendingTransaction.js';
export type { IScrapedTransaction } from './Interfaces/ScrapedTransaction.js';
export type { CurrencySymbol } from './VisaCalBaseTypes.js';
export { TrnTypeCode } from './VisaCalBaseTypes.js';

/** Alias kept for backward compatibility with older consumers. */
export type CardTransactionDetailsError = ICardApiStatus;

/**
 * Check whether the given API result contains a valid authentication module.
 * @param result - The API response to validate.
 * @returns True if the result is a valid IAuthModule.
 */
export function isAuthModule(result: unknown): result is IAuthModule {
  if (!result || typeof result !== 'object') return false;
  const candidate = result as Partial<IAuthModule>;
  return Boolean(candidate.auth?.calConnectToken?.trim());
}

type OptionalAuthModule = IAuthModule | undefined;

/**
 * Return the result as IAuthModule if valid, or undefined otherwise.
 * @param result - The API response to check.
 * @returns The validated IAuthModule, or undefined if invalid.
 */
export function authModuleOrUndefined(result: unknown): OptionalAuthModule {
  return isAuthModule(result) ? result : undefined;
}

/**
 * Type guard distinguishing pending from completed transactions.
 * @param transaction - A completed or pending VisaCal transaction.
 * @returns True if the transaction is pending.
 */
export function isPending(
  transaction: IScrapedTransaction | IScrapedPendingTransaction,
): transaction is IScrapedPendingTransaction {
  return !('debCrdDate' in transaction); // debCrdDate only appears in completed transactions
}

/**
 * Type guard checking whether the API result contains transaction details.
 * @param result - The API response to check.
 * @returns True if the response contains card transaction details.
 */
export function isCardTransactionDetails(
  result: ICardTransactionDetails | ICardApiStatus,
): result is ICardTransactionDetails {
  return 'result' in result;
}

/**
 * Type guard checking whether the API result contains pending transaction details.
 * @param result - The API response to check.
 * @returns True if the response contains pending card transaction details.
 */
export function isCardPendingTransactionDetails(
  result: ICardPendingTransactionDetails | ICardApiStatus,
): result is ICardPendingTransactionDetails {
  return 'result' in result;
}
