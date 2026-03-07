import type { IErrorResult } from '../../Interfaces/Error/ErrorResult';
import type { IWafErrorDetails } from '../../Interfaces/Error/WafErrorDetails';

export type { IErrorResult } from '../../Interfaces/Error/ErrorResult';
export type { IWafErrorDetails } from '../../Interfaces/Error/WafErrorDetails';
export { ScraperErrorTypes } from './ErrorTypes';
export { ScraperWebsiteChangedError } from './ScraperWebsiteChangedError';

import { ScraperErrorTypes } from './ErrorTypes';

/**
 * Builds a base IErrorResult object with a given error type and message.
 *
 * @param errorType - the classified error type
 * @param errorMessage - human-readable description of the error
 * @returns a failed IErrorResult with success=false
 */
function createErrorResult(errorType: ScraperErrorTypes, errorMessage: string): IErrorResult {
  return {
    success: false,
    errorType,
    errorMessage,
  };
}

/**
 * Creates a Timeout error result.
 *
 * @param errorMessage - description of which operation timed out
 * @returns a failed IErrorResult with Timeout error type
 */
export function createTimeoutError(errorMessage: string): IErrorResult {
  return createErrorResult(ScraperErrorTypes.Timeout, errorMessage);
}

/**
 * Creates a Generic error result.
 *
 * @param errorMessage - description of the unexpected error
 * @returns a failed IErrorResult with Generic error type
 */
export function createGenericError(errorMessage: string): IErrorResult {
  return createErrorResult(ScraperErrorTypes.Generic, errorMessage);
}

/**
 * Creates a WafBlocked error result with optional structured WAF details.
 *
 * @param message - human-readable WAF block description
 * @param details - optional structured WAF error details (provider, status, suggestions)
 * @returns a failed IErrorResult with WafBlocked error type
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

/** Error thrown when a WAF (e.g. Cloudflare) blocks an API or page request. */
export class WafBlockError extends Error {
  public readonly details: IWafErrorDetails;

  /**
   * Creates a WafBlockError with structured details about the block.
   *
   * @param details - structured WAF block information including provider, status, and suggestions
   */
  constructor(details: IWafErrorDetails) {
    const httpStatus = String(details.httpStatus);
    const msg =
      `WAF blocked by ${details.provider} (HTTP ${httpStatus}, ` +
      `"${details.pageTitle}"). ${details.suggestions[0]}`;
    super(msg);
    this.name = 'WafBlockError';
    this.details = details;
  }

  /**
   * Creates a WafBlockError for a standard Cloudflare block response.
   *
   * @param httpStatus - the HTTP status code returned by Cloudflare
   * @param pageTitle - the title of the blocked page
   * @param pageUrl - the URL that was blocked
   * @returns a WafBlockError with Cloudflare-specific suggestions
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
   * Creates a WafBlockError for a Cloudflare Turnstile challenge (unsolvable by headless Chrome).
   *
   * @param pageTitle - the title of the challenged page
   * @param pageUrl - the URL that triggered the Turnstile challenge
   * @returns a WafBlockError with Turnstile-specific suggestions
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
   * Creates a WafBlockError for a non-Cloudflare API-level block.
   *
   * @param httpStatus - the HTTP status code returned by the API
   * @param pageUrl - the URL of the blocked API endpoint
   * @param opts - optional extra context
   * @param opts.pageTitle - optional title of the error page
   * @param opts.responseSnippet - optional snippet of the raw response body
   * @returns a WafBlockError with generic IP-cooldown suggestions
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
