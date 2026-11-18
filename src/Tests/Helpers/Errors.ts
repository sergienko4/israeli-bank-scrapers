import type { IErrorResult } from '../../Scrapers/Base/Interfaces/ErrorResult.js';

export { ScraperErrorTypes } from '../../Scrapers/Base/ErrorTypes.js';
export type { IErrorResult } from '../../Scrapers/Base/Interfaces/ErrorResult.js';

import { ScraperErrorTypes } from '../../Scrapers/Base/ErrorTypes.js';

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
