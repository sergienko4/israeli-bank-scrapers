import type { IErrorResult } from './Interfaces/ErrorResult.js';
import type { IWafErrorDetails } from './Interfaces/WafErrorDetails.js';

export { ScraperErrorTypes } from './ErrorTypes.js';
export type { IErrorResult } from './Interfaces/ErrorResult.js';
export type { IWafErrorDetails } from './Interfaces/WafErrorDetails.js';

import { ScraperErrorTypes } from './ErrorTypes.js';

/**
 * Create a typed error result with success=false.
 * @param errorType - The scraper error type classification.
 * @param errorMessage - A human-readable error description.
 * @returns A structured error result.
 */
function createErrorResult(errorType: ScraperErrorTypes, errorMessage: string): IErrorResult {
  return {
    success: false,
    errorType,
    errorMessage,
  };
}

/**
 * Create a timeout error result.
 * @param errorMessage - A description of the timeout condition.
 * @returns A timeout error result.
 */
export function createTimeoutError(errorMessage: string): IErrorResult {
  return createErrorResult(ScraperErrorTypes.Timeout, errorMessage);
}

/**
 * Create a generic error result.
 * @param errorMessage - A description of the error condition.
 * @returns A generic error result.
 */
export function createGenericError(errorMessage: string): IErrorResult {
  return createErrorResult(ScraperErrorTypes.Generic, errorMessage);
}

/**
 * Create a change-password error result.
 * @param errorMessage - A description of the password-change requirement.
 * @returns A change-password error result.
 */
export function createChangePasswordError(errorMessage: string): IErrorResult {
  return createErrorResult(ScraperErrorTypes.ChangePassword, errorMessage);
}

/**
 * Create a WAF-blocked error result with optional details.
 * @param message - A description of the WAF block.
 * @param details - Optional structured WAF error details.
 * @returns A WAF-blocked error result.
 */
export function createWafBlockedError(message: string, details?: IWafErrorDetails): IErrorResult {
  return {
    success: false,
    errorType: ScraperErrorTypes.WafBlocked,
    errorMessage: message,
    errorDetails: details,
  };
}

const WAF_SUGGESTIONS = {
  ipCooldown: 'Wait 1-2 hours for IP reputation to recover',
  residentialProxy: 'Use a residential/non-datacenter proxy',
  avoidRapidRetries: 'Avoid running multiple scrape attempts in quick succession',
  turnstileLimit: 'Cloudflare Turnstile cannot be solved by headless Chrome',
  trustedIp: 'Use Microsoft Azure or residential IP (not Oracle Cloud/AWS)',
} as const;

/** Structured error for WAF/IP block scenarios with provider-specific details. */
export class WafBlockError extends Error {
  public readonly details: IWafErrorDetails;

  /**
   * Create a WAF block error with structured details.
   * @param details - The structured WAF error details.
   */
  constructor(details: IWafErrorDetails) {
    const httpStatusStr = String(details.httpStatus);
    const msg =
      `WAF blocked by ${details.provider} ` +
      `(HTTP ${httpStatusStr}, "${details.pageTitle}"). ` +
      details.suggestions[0];
    super(msg);
    this.name = 'WafBlockError';
    this.details = details;
  }

  /**
   * Create a Cloudflare WAF block error.
   * @param httpStatus - The HTTP status code from Cloudflare.
   * @param pageTitle - The page title returned by Cloudflare.
   * @param pageUrl - The URL that was blocked.
   * @returns A WafBlockError for Cloudflare blocks.
   */
  public static cloudflareBlock(
    httpStatus: number,
    pageTitle: string,
    pageUrl: string,
  ): WafBlockError {
    return new WafBlockError({
      provider: 'cloudflare',
      httpStatus,
      pageTitle,
      pageUrl,
      suggestions: [
        WAF_SUGGESTIONS.ipCooldown,
        WAF_SUGGESTIONS.residentialProxy,
        WAF_SUGGESTIONS.avoidRapidRetries,
      ],
    });
  }

  /**
   * Create a Cloudflare Turnstile challenge error.
   * @param pageTitle - The page title of the Turnstile challenge.
   * @param pageUrl - The URL with the Turnstile challenge.
   * @returns A WafBlockError for Turnstile challenges.
   */
  public static cloudflareTurnstile(pageTitle: string, pageUrl: string): WafBlockError {
    return new WafBlockError({
      provider: 'cloudflare',
      httpStatus: 403,
      pageTitle,
      pageUrl,
      suggestions: [WAF_SUGGESTIONS.trustedIp, WAF_SUGGESTIONS.turnstileLimit],
    });
  }

  /**
   * Create a generic API block error from an unknown WAF provider.
   * @param httpStatus - The HTTP status code received.
   * @param pageUrl - The URL of the blocked API call.
   * @param opts - Optional page title and response snippet for diagnostics.
   * @param opts.pageTitle - The page title from the blocked response.
   * @param opts.responseSnippet - A snippet of the response body for diagnostics.
   * @returns A WafBlockError for API-level blocks.
   */
  public static apiBlock(
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
