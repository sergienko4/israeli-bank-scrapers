/**
 * Procedure (Result Pattern) — every pipeline step returns this.
 * Discriminated union: `success: true` for success, `success: false` for failure.
 */

import { ScraperErrorTypes } from '../../Base/ErrorTypes.js';
import type { IScraperScrapingResult } from '../../Base/Interface.js';
import type { IWafErrorDetails } from '../../Base/Interfaces/WafErrorDetails.js';
import { none, type Option, some } from './Option.js';

/** Successful procedure outcome carrying a typed payload. */
interface IProcedureSuccess<T> {
  readonly success: true;
  readonly value: T;
}

/** Failed procedure outcome with structured error. */
interface IProcedureFailure {
  readonly success: false;
  readonly errorType: ScraperErrorTypes;
  readonly errorMessage: string;
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
 * Whether a procedure failed because the bank's edge (WAF) refused the call.
 * Such a failure is terminal: the bank never saw the request, so re-minting a
 * token, re-running the login (which may send an SMS OTP) or answering from a
 * fallback cannot help and would only hide the block.
 * @param proc - Any procedure.
 * @returns True only for a failure typed `WafBlocked`.
 */
function isWafBlocked<T>(proc: Procedure<T>): boolean {
  if (isOk(proc)) return false;
  return proc.errorType === ScraperErrorTypes.WafBlocked;
}

/**
 * Answer with a repair attempt's edge (WAF) refusal when it has one.
 * A token refresh or session recovery runs because an earlier outcome looked
 * broken. When the edge refuses that repair, keeping the earlier outcome — an
 * auth rejection, or a degraded success — would hide the block from every
 * WAF guard downstream, so the refusal replaces it.
 * @param repair - The refresh or recovery procedure.
 * @param earlier - The outcome the repair was meant to fix.
 * @returns The repair's WAF failure, else the earlier outcome.
 */
function preferWafBlock<T, TRepair>(
  repair: Procedure<TRepair>,
  earlier: Procedure<T>,
): Procedure<T> {
  if (isOk(repair)) return earlier;
  if (isWafBlocked(repair)) return repair;
  return earlier;
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
export { fail, failWithDetails, fromLegacy, isOk, isWafBlocked, preferWafBlock, succeed, toLegacy };
