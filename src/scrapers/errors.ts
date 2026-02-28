export enum ScraperErrorTypes {
  TwoFactorRetrieverMissing = 'TWO_FACTOR_RETRIEVER_MISSING',
  InvalidOtp = 'INVALID_OTP',
  InvalidPassword = 'INVALID_PASSWORD',
  ChangePassword = 'CHANGE_PASSWORD',
  Timeout = 'TIMEOUT',
  AccountBlocked = 'ACCOUNT_BLOCKED',
  Generic = 'GENERIC',
  /** @deprecated Use `Generic` instead. Kept for backwards-compatibility. */
  General = 'GENERAL_ERROR',
  WafBlocked = 'WAF_BLOCKED',
}

export interface WafErrorDetails {
  provider: 'cloudflare' | 'unknown';
  httpStatus: number;
  pageTitle: string;
  pageUrl: string;
  responseSnippet?: string;
  suggestions: string[];
}

export type ErrorResult = {
  success: false;
  errorType: ScraperErrorTypes;
  errorMessage: string;
  errorDetails?: WafErrorDetails;
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

export function createWafBlockedError(message: string, details?: WafErrorDetails): ErrorResult {
  return { success: false, errorType: ScraperErrorTypes.WafBlocked, errorMessage: message, errorDetails: details };
}

const WAF_SUGGESTIONS = {
  ipCooldown: 'Wait 1-2 hours for IP reputation to recover',
  residentialProxy: 'Use a residential/non-datacenter proxy',
  avoidRapidRetries: 'Avoid running multiple scrape attempts in quick succession',
  turnstileLimit: 'Cloudflare Turnstile cannot be solved by headless Chrome',
  trustedIp: 'Use Microsoft Azure or residential IP (not Oracle Cloud/AWS)',
} as const;

export class WafBlockError extends Error {
  public readonly details: WafErrorDetails;

  constructor(details: WafErrorDetails) {
    const msg = `WAF blocked by ${details.provider} (HTTP ${details.httpStatus}, "${details.pageTitle}"). ${details.suggestions[0]}`;
    super(msg);
    this.name = 'WafBlockError';
    this.details = details;
  }

  static cloudflareBlock(httpStatus: number, pageTitle: string, pageUrl: string): WafBlockError {
    return new WafBlockError({
      provider: 'cloudflare',
      httpStatus,
      pageTitle,
      pageUrl,
      suggestions: [WAF_SUGGESTIONS.ipCooldown, WAF_SUGGESTIONS.residentialProxy, WAF_SUGGESTIONS.avoidRapidRetries],
    });
  }

  static cloudflareTurnstile(pageTitle: string, pageUrl: string): WafBlockError {
    return new WafBlockError({
      provider: 'cloudflare',
      httpStatus: 403,
      pageTitle,
      pageUrl,
      suggestions: [WAF_SUGGESTIONS.trustedIp, WAF_SUGGESTIONS.turnstileLimit],
    });
  }

  static apiBlock(
    httpStatus: number,
    pageUrl: string,
    opts: { pageTitle?: string; responseSnippet?: string } = {},
  ): WafBlockError {
    return new WafBlockError({
      provider: 'unknown',
      httpStatus,
      pageTitle: opts.pageTitle ?? '',
      pageUrl,
      responseSnippet: opts.responseSnippet?.substring(0, 200),
      suggestions: [WAF_SUGGESTIONS.ipCooldown, WAF_SUGGESTIONS.avoidRapidRetries],
    });
  }
}
