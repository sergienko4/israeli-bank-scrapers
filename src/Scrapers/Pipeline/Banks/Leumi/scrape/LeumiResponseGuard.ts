/**
 * Leumi WCF checks reject malformed financial data before tolerant extractors
 * can turn it into an apparent zero balance or empty transaction history.
 */

import type { WindowCaveat } from '../../../../../WindowCoverage.js';
import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type {
  ApiBody,
  BodyCheck,
  IApiDirectScrapeGuardSummary,
  OperationBodyChecks,
} from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import {
  validAccounts,
  validTransactionAmount,
  validTransactionSource,
} from './LeumiFinancialValidation.js';

type InnerCheck = (inner: Record<string, unknown>) => boolean;

const LOSS_CAVEATS: readonly WindowCaveat[] = [
  'declaredRowShortfall',
  'extractionShortfall',
  'mappingRejectedRows',
];

/**
 * Narrows an untrusted JSON value to an object.
 * @param value - Untrusted value.
 * @returns Whether it is a non-array object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Requires at least one unambiguous account.
 * @param inner - Decoded customer response.
 * @returns Whether the account list is valid.
 */
function validCustomer(inner: Record<string, unknown>): boolean {
  const accounts = inner.AccountsItems;
  return Array.isArray(accounts) && accounts.length > 0 && validAccounts(accounts);
}

/**
 * Requires an explicitly successful WCF operation status.
 * @param inner - Decoded financial response.
 * @returns Whether the bank reported success.
 */
function validStatus(inner: Record<string, unknown>): boolean {
  return isRecord(inner.SOStatus) && inner.SOStatus.Status === true;
}

/**
 * Distinguishes a genuine zero balance from a missing figure.
 * @param inner - Decoded balance response.
 * @returns Whether the bank supplied a finite balance and successful status.
 */
function validBalance(inner: Record<string, unknown>): boolean {
  const balance = inner.BalanceDisplay;
  return validStatus(inner) && typeof balance === 'number' && Number.isFinite(balance);
}

/**
 * Requires a successful status and valid transaction source fields.
 * @param inner - Decoded transactions response.
 * @returns Whether all transaction fields are usable.
 */
function validTransactions(inner: Record<string, unknown>): boolean {
  const rows = inner.HistoryTransactionsItems;
  return (
    validStatus(inner) &&
    Array.isArray(rows) &&
    rows.every(validTransactionAmount) &&
    rows.every(validTransactionSource)
  );
}

/**
 * Refuses a WCF response without exposing its contents.
 * @returns A sanitized validation failure.
 */
function invalidBody(): Procedure<never> {
  return fail(ScraperErrorTypes.Generic, 'Leumi WCF response failed validation');
}

/**
 * Decodes the WCF envelope only when the outer operation succeeded.
 * @param body - Untrusted response envelope.
 * @returns A decoded object or a sanitized failure.
 */
function parseInner(body: ApiBody): Procedure<Record<string, unknown>> {
  if (body.ProcessRequestResult !== 0 || typeof body.jsonResp !== 'string') return invalidBody();
  try {
    const parsed: unknown = JSON.parse(body.jsonResp);
    return isRecord(parsed) ? succeed(parsed) : invalidBody();
  } catch {
    return invalidBody();
  }
}

/**
 * Adapts an inner-response validator to the scrape body-check contract.
 * @param validate - Validator for the selected operation.
 * @param operation - Safe operation label for failures.
 * @returns A body check preserving the accepted envelope.
 */
function bodyCheck(validate: InnerCheck, operation: string): BodyCheck {
  return (body): Procedure<ApiBody> => {
    const inner = parseInner(body);
    if (!isOk(inner) || !validate(inner.value)) {
      return fail(ScraperErrorTypes.Generic, `Leumi ${operation} WCF response failed validation`);
    }
    return succeed(body);
  };
}

/** Per-operation WCF validation before any financial extraction. */
export const LEUMI_BODY_CHECKS: OperationBodyChecks = {
  customer: bodyCheck(validCustomer, 'customer'),
  balance: bodyCheck(validBalance, 'balance'),
  txns: bodyCheck(validTransactions, 'transactions'),
};

/**
 * Refuses missing financial evidence and observed row loss.
 * @param summary - PII-free signals from the completed scrape.
 * @returns A failure when financial results cannot be trusted.
 */
export function leumiResultGuard(summary: IApiDirectScrapeGuardSummary): Procedure<void> {
  const { observedCaveats } = summary;
  if (summary.accountCount < 1 || summary.balanceDegraded || observedCaveats === undefined) {
    return fail(ScraperErrorTypes.Generic, 'Leumi financial evidence is incomplete');
  }
  if (LOSS_CAVEATS.some(caveat => observedCaveats.includes(caveat))) {
    return fail(ScraperErrorTypes.Generic, 'Leumi scrape observed transaction loss');
  }
  return succeed(undefined);
}
