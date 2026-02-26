export enum ScraperErrorTypes {
  TwoFactorRetrieverMissing = 'TWO_FACTOR_RETRIEVER_MISSING',
  InvalidPassword = 'INVALID_PASSWORD',
  ChangePassword = 'CHANGE_PASSWORD',
  Timeout = 'TIMEOUT',
  AccountBlocked = 'ACCOUNT_BLOCKED',
  Generic = 'GENERIC',
  General = 'GENERAL_ERROR',
  WafBlocked = 'WAF_BLOCKED',
}

export type ErrorResult = {
  success: false;
  errorType: ScraperErrorTypes;
  errorMessage: string;
};

function createErrorResult(errorType: ScraperErrorTypes, errorMessage: string): ErrorResult {
  return {
    success: false,
    errorType,
    errorMessage,
  };
}

export function createTimeoutError(errorMessage: string): ErrorResult {
  return createErrorResult(ScraperErrorTypes.Timeout, errorMessage);
}

export function createGenericError(errorMessage: string): ErrorResult {
  return createErrorResult(ScraperErrorTypes.Generic, errorMessage);
}

export function createWafBlockedError(errorMessage: string): ErrorResult {
  return createErrorResult(ScraperErrorTypes.WafBlocked, errorMessage);
}

export class WafBlockError extends Error {
  constructor(
    public readonly reason: string,
    public readonly pageUrl: string,
    public readonly httpStatus?: number,
  ) {
    super(`WAF blocked: ${reason} (pageUrl=${pageUrl})`);
    this.name = 'WafBlockError';
  }
}
