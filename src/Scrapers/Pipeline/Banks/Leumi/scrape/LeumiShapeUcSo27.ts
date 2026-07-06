/**
 * Leumi scrape shape — the `UC_SO_27_GetBusinessAccountTrx` request
 * builder shared by the balance + transactions steps. Both hit the same
 * WCF module; they differ only in a four-field variant (request type +
 * date range + period) captured from the real Leumi network trace:
 *   - balance      → RequestType '', empty dates, PeriodType '0'
 *   - transactions → RequestType 'OpersB', dated range, PeriodType '3'
 *
 * Field value TYPES mirror the wire exactly (`Amount*` are numbers;
 * every other scalar is a string) — `.NET` WCF deserialises by name, so
 * the base + variant merge is contract-faithful.
 */

import type { VarsMap } from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { IActionContext } from '../../../Types/PipelineContext.js';
import { sessionHeader, wcfEnvelope } from './LeumiShapeEnvelope.js';

/** WCF module both the balance + transactions calls dispatch. */
export const UC_SO_27_MODULE = 'UC_SO_27_GetBusinessAccountTrx';

/** The four fields that differ between the balance + transactions calls. */
export interface IUcSo27Variant {
  readonly requestType: string;
  readonly fromDateUtc: string;
  readonly toDateUtc: string;
  readonly periodType: string;
}

/** UC_SO_27 fixed fields — identical for the balance + transactions calls. */
const UC_SO_27_BASE = {
  StateName: 'BusinessAccountTrx',
  ModuleName: UC_SO_27_MODULE,
  OperationsNumber: '40',
  Amount: 0,
  AmountType1: 0,
  AmountType2: 0,
  TrxType: '1',
  ReferenceNumber: '0',
  BeneficiaryName: '0',
  BeneficiaryBankCode: '0',
  BeneficiaryBranch: '0',
  BeneficiaryAccountNumber: '0',
  InvoiceNumber: '0',
} as const;

/**
 * Merge the fixed base with the per-call variant + runtime session +
 * account index into the UC_SO_27 inner request.
 * @param accountIndex - Target account index.
 * @param ctx - Action context (SessionHeader source).
 * @param variant - Request-type + date-range + period fields.
 * @returns UC_SO_27 inner request object.
 */
function ucSo27Inner(
  accountIndex: number,
  ctx: IActionContext,
  variant: IUcSo27Variant,
): Record<string, unknown> {
  return {
    ...UC_SO_27_BASE,
    SessionHeader: sessionHeader(ctx),
    RequestType: variant.requestType,
    FromDateUTC: variant.fromDateUtc,
    ToDateUTC: variant.toDateUtc,
    PeriodType: variant.periodType,
    AccountIndex: accountIndex,
  };
}

/**
 * Build the UC_SO_27 envelope for the balance or transactions call.
 * @param accountIndex - Target account index.
 * @param ctx - Action context.
 * @param variant - Per-call variant (balance vs dated txns).
 * @returns Envelope vars map posted verbatim.
 */
export function ucSo27Vars(
  accountIndex: number,
  ctx: IActionContext,
  variant: IUcSo27Variant,
): VarsMap {
  const inner = ucSo27Inner(accountIndex, ctx, variant);
  return wcfEnvelope(UC_SO_27_MODULE, inner);
}
