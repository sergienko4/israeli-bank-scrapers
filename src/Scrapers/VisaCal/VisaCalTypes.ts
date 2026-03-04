import type { AuthModule } from './Interfaces/AuthModule';
import type { CardApiStatus } from './Interfaces/CardApiStatus';
import type { CardPendingTransactionDetails } from './Interfaces/CardPendingTransactionDetails';
import type { CardTransactionDetails } from './Interfaces/CardTransactionDetails';
import type { ScrapedPendingTransaction } from './Interfaces/ScrapedPendingTransaction';
import type { ScrapedTransaction } from './Interfaces/ScrapedTransaction';

export type { ApiContext } from './Interfaces/ApiContext';
export type { AuthModule } from './Interfaces/AuthModule';
export type { CardApiStatus } from './Interfaces/CardApiStatus';
export type { CardInfo } from './Interfaces/CardInfo';
export type { CardLevelFrame } from './Interfaces/CardLevelFrame';
export type { CardPendingTransactionDetails } from './Interfaces/CardPendingTransactionDetails';
export type { CardTransactionDetails } from './Interfaces/CardTransactionDetails';
export type { FramesResponse } from './Interfaces/FramesResponse';
export type { InitResponse } from './Interfaces/InitResponse';
export type { LoginResponse } from './Interfaces/LoginResponse';
export type { ScrapedPendingTransaction } from './Interfaces/ScrapedPendingTransaction';
export type { ScrapedTransaction } from './Interfaces/ScrapedTransaction';
export type { CurrencySymbol } from './VisaCalBaseTypes';
export { TrnTypeCode } from './VisaCalBaseTypes';

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
