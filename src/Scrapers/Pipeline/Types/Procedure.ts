/**
 * Procedure (Result Pattern) — every pipeline step returns this.
 * Discriminated union: `success: true` for success, `success: false` for failure.
 */

import { ScraperErrorTypes } from '../../Base/ErrorTypes.js';
import type { IScraperScrapingResult } from '../../Base/Interface.js';
import type { IWafErrorDetails } from '../../Base/Interfaces/WafErrorDetails.js';
import { none, type Option } from './Option.js';

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
  readonly responseIntegrityRefusal?: true;
  /** HTTP status the bank answered, when the failure came from a response. */
  readonly httpStatus?: number;
  /** Set when a shape callback throw was converted into a failure. */
  readonly shapeGuardFailure?: true;
  /** Set when the message is bank text that must never drive auth recovery. */
  readonly messageOnlyFailure?: true;
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
 * @param httpStatus - HTTP status the bank answered, when one is known.
 * @returns A failure Procedure.
 */
function fail(
  errorType: ScraperErrorTypes,
  errorMessage: string,
  httpStatus?: number,
): IProcedureFailure {
  return attachStatus(
    { success: false, errorType, errorMessage, errorDetails: none() },
    httpStatus,
  );
}

/**
 * Attach a response status when one is known.
 * @param failure - Failure to extend.
 * @param httpStatus - HTTP status, or undefined when unknown.
 * @returns The failure, carrying the status when known.
 */
function attachStatus(failure: IProcedureFailure, httpStatus?: number): IProcedureFailure {
  return httpStatus === undefined ? failure : { ...failure, httpStatus };
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
 * Whether an edge or response-integrity refusal must stop recovery.
 * @param proc - Any procedure.
 * @returns True for a WAF block or a response-integrity refusal.
 */
function isTerminalFailure<T>(proc: Procedure<T>): boolean {
  if (isOk(proc)) return false;
  return isWafBlocked(proc) || proc.responseIntegrityRefusal === true;
}

/**
 * Answer with a repair attempt's terminal refusal when it has one.
 * A token refresh or session recovery runs because an earlier outcome looked
 * broken. Keeping the earlier outcome — an auth rejection, or a degraded
 * success — would hide a terminal refusal from guards downstream.
 * @param repair - The refresh or recovery procedure.
 * @param earlier - The outcome the repair was meant to fix.
 * @returns The repair's terminal refusal, else the earlier outcome.
 */
function preferTerminalFailure<T, TRepair>(
  repair: Procedure<TRepair>,
  earlier: Procedure<T>,
): Procedure<T> {
  if (isOk(repair)) return earlier;
  if (isTerminalFailure(repair)) return repair;
  return earlier;
}

/** Auth statuses whose marker must survive legacy conversion. */
const AUTH_STATUSES: ReadonlySet<number> = new Set([401, 403]);

/** Matches either existing auth marker the legacy message may already carry. */
const AUTH_MARKER = /\s(?:(?:401|403):\s|HTTP (?:401|403)$)/;

/**
 * Preserve an auth status as a marker when the message has none.
 * @param proc - The internal failure result.
 * @returns The legacy message.
 */
function legacyMessage(proc: IProcedureFailure): string {
  const { httpStatus, errorMessage } = proc;
  if (httpStatus === undefined || !AUTH_STATUSES.has(httpStatus)) return errorMessage;
  if (AUTH_MARKER.test(errorMessage)) return errorMessage;
  const status = String(httpStatus);
  return `${errorMessage} HTTP ${status}`;
}

/**
 * The error fields every legacy failure carries.
 * @param proc - The internal failure result.
 * @returns A legacy failure without error details.
 */
function legacyBase(proc: IProcedureFailure): IScraperScrapingResult {
  return {
    success: false,
    errorType: proc.errorType,
    errorMessage: legacyMessage(proc),
  };
}

/**
 * Convert Procedure back to IScraperScrapingResult for backward compat.
 * @param proc - The internal Procedure result.
 * @returns A legacy result shape.
 */
function toLegacy<T>(proc: Procedure<T>): IScraperScrapingResult {
  if (proc.success) return { success: true };
  const base = legacyBase(proc);
  if (!proc.errorDetails.has) return base;
  return { ...base, errorDetails: proc.errorDetails.value };
}

export type { IProcedureFailure, IProcedureSuccess, Procedure };
export { fail, isOk, isTerminalFailure, isWafBlocked, preferTerminalFailure, succeed, toLegacy };
