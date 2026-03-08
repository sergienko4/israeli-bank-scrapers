import type { AuthModule } from './Interfaces/AuthModule.js';
import type { CardApiStatus } from './Interfaces/CardApiStatus.js';
import type { CardPendingTransactionDetails } from './Interfaces/CardPendingTransactionDetails.js';
import type { CardTransactionDetails } from './Interfaces/CardTransactionDetails.js';
import type { ScrapedPendingTransaction } from './Interfaces/ScrapedPendingTransaction.js';
import type { ScrapedTransaction } from './Interfaces/ScrapedTransaction.js';

export type { ApiContext } from './Interfaces/ApiContext.js';
export type { AuthModule } from './Interfaces/AuthModule.js';
export type { CardApiStatus } from './Interfaces/CardApiStatus.js';
export type { CardInfo } from './Interfaces/CardInfo.js';
export type { CardLevelFrame } from './Interfaces/CardLevelFrame.js';
export type { CardPendingTransactionDetails } from './Interfaces/CardPendingTransactionDetails.js';
export type { CardTransactionDetails } from './Interfaces/CardTransactionDetails.js';
export type { FramesResponse } from './Interfaces/FramesResponse.js';
export type { InitResponse } from './Interfaces/InitResponse.js';
export type { LoginResponse } from './Interfaces/LoginResponse.js';
export type { ScrapedPendingTransaction } from './Interfaces/ScrapedPendingTransaction.js';
export type { ScrapedTransaction } from './Interfaces/ScrapedTransaction.js';
export type { CurrencySymbol } from './VisaCalBaseTypes.js';
export { TrnTypeCode } from './VisaCalBaseTypes.js';

/** @deprecated use CardApiStatus */
export type CardTransactionDetailsError = CardApiStatus;

export function isAuthModule(result: unknown): result is AuthModule {
  if (!result || typeof result !== 'object') return false;
  const candidate = result as Partial<AuthModule>;
  return Boolean(candidate.auth?.calConnectToken?.trim());
}

export function authModuleOrUndefined(result: unknown): AuthModule | undefined {
  return isAuthModule(result) ? result : undefined;
}

export function isPending(
  transaction: ScrapedTransaction | ScrapedPendingTransaction,
): transaction is ScrapedPendingTransaction {
  return !('debCrdDate' in transaction); // debCrdDate only appears in completed transactions
}

export function isCardTransactionDetails(
  result: CardTransactionDetails | CardApiStatus,
): result is CardTransactionDetails {
  return 'result' in result;
}

export function isCardPendingTransactionDetails(
  result: CardPendingTransactionDetails | CardApiStatus,
): result is CardPendingTransactionDetails {
  return 'result' in result;
}
