/**
 * Procedure (Result Pattern) — every pipeline step returns this.
 * Discriminated union: `success: true` for success, `success: false` for failure.
 */

import { ScraperErrorTypes } from '../../Base/ErrorTypes.js';
import type { IScraperScrapingResult } from '../../Base/Interface.js';
import type { IWafErrorDetails } from '../../Base/Interfaces/WafErrorDetails.js';
import { none, type Option, some } from './Option.js';

/** Human-readable error message for failed procedure outcomes. */
type ProcedureErrMsg = string;

/** Successful procedure outcome carrying a typed payload. */
interface IProcedureSuccess<T> {
  readonly success: true;
  readonly value: T;
}

/** Failed procedure outcome with structured error. */
interface IProcedureFailure {
  readonly success: false;
  readonly errorType: ScraperErrorTypes;
  readonly errorMessage: ProcedureErrMsg;
  readonly errorDetails: Option<IWafErrorDetails>;
}

/** Discriminated union — every pipeline step returns this. */
type Procedure<T> = IProcedureSuccess<T> | IProcedureFailure;

/**
 * Create a success result.
 * @param value - The payload value.
 * @returns A success Procedure.
 */
function succeed<T>(value: T): IProcedureSuccess<T> {
  return { success: true, value };
}

/**
 * Create a failure result.
 * @param errorType - The categorized error type.
 * @param errorMessage - Human-readable error description.
 * @returns A failure Procedure.
 */
function fail(errorType: ScraperErrorTypes, errorMessage: string): IProcedureFailure {
  return { success: false, errorType, errorMessage, errorDetails: none() };
}

/**
 * Create a failure result with WAF error details.
 * @param errorType - The categorized error type.
 * @param errorMessage - Human-readable error description.
 * @param details - WAF-specific error details.
 * @returns A failure Procedure with error details.
 */
function failWithDetails(
  errorType: ScraperErrorTypes,
  errorMessage: string,
  details: IWafErrorDetails,
): IProcedureFailure {
  return {
    success: false,
    errorType,
    errorMessage,
    errorDetails: some(details),
  };
}

/**
 * Type guard: narrows Procedure to success.
 * @param proc - The Procedure to check.
 * @returns True if the procedure succeeded.
 */
function isOk<T>(proc: Procedure<T>): proc is IProcedureSuccess<T> {
  return proc.success;
}

/**
 * Convert legacy IScraperScrapingResult to Procedure.
 * @param result - Legacy result from existing scrapers.
 * @returns A typed Procedure.
 */
function fromLegacy(result: IScraperScrapingResult): Procedure<IScraperScrapingResult> {
  if (result.success) return succeed(result);
  const errorType = result.errorType ?? ScraperErrorTypes.Generic;
  const errorMessage = result.errorMessage ?? 'Unknown error';
  const details = result.errorDetails;
  if (details) return failWithDetails(errorType, errorMessage, details);
  return fail(errorType, errorMessage);
}

/**
 * Convert Procedure back to IScraperScrapingResult for backward compat.
 * @param proc - The internal Procedure result.
 * @returns A legacy result shape.
 */
function toLegacy<T>(proc: Procedure<T>): IScraperScrapingResult {
  if (proc.success) return { success: true };
  const base = {
    success: false as const,
    errorType: proc.errorType,
    errorMessage: proc.errorMessage,
  };
  if (proc.errorDetails.has) {
    const withDetails: IScraperScrapingResult = { ...base, errorDetails: proc.errorDetails.value };
    return withDetails;
  }
  return base;
}

export type { IProcedureFailure, IProcedureSuccess, Procedure };
export { fail, failWithDetails, fromLegacy, isOk, succeed, toLegacy };
