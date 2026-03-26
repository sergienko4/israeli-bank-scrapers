/**
 * Dynamic Metadata Mapper — generic card-account extractor.
 *
 * ZERO HARDCODED KEYS — driven entirely by PIPELINE_WELL_KNOWN fields.
 *
 *   Level 0 — Validate the API response status:
 *     findFieldValue(raw, wk.responseStatus)  — BFS, no 'Header.Status' hardcoding
 *
 *   Level 1 — Find the charge array:
 *     findFirstArray(raw)  — BFS, no 'DashboardMonthBean.cardsCharges' hardcoding
 *
 *   Level 2 — Find fields within each charge object:
 *     matchField(charge, wk.queryId)       — cardIndex ('0', '1', …) via WK aliases
 *     matchField(charge, wk.displayId)     — cardNumber ('9371') via WK aliases
 *     matchField(charge, wk.processedDate) — billingDate via WK aliases
 *
 * CANONICAL ENTRY POINT:
 *   extract(raw, PIPELINE_WELL_KNOWN)
 *   — accepts the full WK dictionary; uses only the fields it needs.
 *
 * Rule #11: Zero bank-specific code. The WK dictionary IS the bank config.
 * Rule #15: Returns Procedure<T>. No raw primitives.
 */

import { getDebug } from '../../../../Common/Debug.js';
import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import {
  findFieldValue,
  findFirstArray,
  matchField,
} from '../../Mediator/GenericScrapeStrategy.js';
import { fail, isOk, type Procedure, succeed } from '../../Types/Procedure.js';

const LOG = getDebug('dynamic-metadata-mapper');

// ── WK interface — subset of PIPELINE_WELL_KNOWN ─────────

/**
 * The fields from PIPELINE_WELL_KNOWN that extract() uses.
 * PIPELINE_WELL_KNOWN structurally satisfies this interface.
 */
export interface IWkAccountFields {
  readonly responseStatus: readonly string[];
  readonly queryId: readonly string[];
  readonly displayId: readonly string[];
  readonly processedDate: readonly string[];
}

// ── Output type — WK-aligned field names ─────────────────

/** A card account extracted via WK discovery — field names match the WK dictionary. */
export interface IWkAccount {
  /** Internal query key — maps to 'card_N' in CardsTransactionsListBean. WK: queryId. */
  readonly queryId: WkQueryId;
  /** Display label shown to user (last 4 digits). WK: displayId. */
  readonly displayId: WkDisplayId;
  /** Billing cycle date. WK: processedDate. */
  readonly processedDate: WkDate;
}

/** Expected API success status value across all Isracard/Amex portal APIs. */
const API_STATUS_OK = '1';

/** Non-null, non-array API object. Avoids 'unknown' in type annotations (Rule: no-unknown). */
type JsonObject = Record<string, string | number | boolean | null>;

// ── Semantic type aliases (Rule #15: no raw primitives) ───

/** Internal query key — card index ('0', '1') or GUID for billing API. */
type WkQueryId = string;
/** Display label — last 4 digits of card shown to user. */
type WkDisplayId = string;
/** Billing cycle date string. */
type WkDate = string;
/** WK field name — used only for debug logging. */
type WkFieldName = string;

// ── Per-charge extraction (guard clauses only) ────────────

/**
 * Extract a string value via WK aliases — logs which key resolved it.
 * Returns fail() if no alias matched.
 * @param charge - Raw charge object.
 * @param aliases - WK alias list.
 * @param wkFieldName - WK field name for debug logging.
 * @returns Procedure with resolved string value, or fail() if no alias matched.
 */
function resolveField(
  charge: Record<string, unknown>,
  aliases: readonly string[],
  wkFieldName: WkFieldName,
): Procedure<WkQueryId> {
  const matchResult = matchField(charge, aliases);
  if (!isOk(matchResult)) {
    LOG.debug('dynamic-mapper: wk.%s not found — no alias matched', wkFieldName);
    return fail(ScraperErrorTypes.Generic, `wk.${wkFieldName} not found — no alias matched`);
  }
  LOG.debug(
    'dynamic-mapper: wk.%s resolved — rawKey="%s" wkAlias="%s"',
    wkFieldName,
    matchResult.value.originalKey,
    matchResult.value.matchingKey,
  );
  const resolved = String(matchResult.value.value);
  return succeed(resolved);
}

/**
 * Map one charge object to IWkAccount using the WK dictionary.
 * Returns fail() if a required field is missing.
 * @param charge - Raw charge from the array.
 * @param wk - WK account fields subset.
 * @returns Procedure with mapped IWkAccount, or fail() if required field missing.
 */
function mapCharge(charge: Record<string, unknown>, wk: IWkAccountFields): Procedure<IWkAccount> {
  const queryIdResult = resolveField(charge, wk.queryId, 'queryId');
  if (!isOk(queryIdResult)) return queryIdResult;

  const displayIdResult = resolveField(charge, wk.displayId, 'displayId');
  if (!isOk(displayIdResult)) return displayIdResult;

  const processedDateResult = resolveField(charge, wk.processedDate, 'processedDate');
  let processedDate: WkDate = '';
  if (isOk(processedDateResult)) processedDate = processedDateResult.value;
  return succeed({ queryId: queryIdResult.value, displayId: displayIdResult.value, processedDate });
}

// ── Public API ────────────────────────────────────────────

/**
 * Accumulate one charge into a result array — used by extractWithWkMap's reduce.
 * @param acc - Accumulated result so far.
 * @param charge - Raw charge to add.
 * @param wk - WK account fields.
 * @returns Updated accumulator, or fail() if charge mapping fails.
 */
function accumulate(
  acc: Procedure<IWkAccount[]>,
  charge: Record<string, unknown>,
  wk: IWkAccountFields,
): Procedure<IWkAccount[]> {
  if (!isOk(acc)) return acc;
  const chargeResult = mapCharge(charge, wk);
  if (!isOk(chargeResult)) return chargeResult;
  return succeed([...acc.value, chargeResult.value]);
}

/**
 * Low-level: extract card accounts from a pre-discovered charge array.
 * (Does not include status check or array discovery.)
 *
 * @param charges - Pre-discovered array of raw charge objects.
 * @param wk - WK account fields.
 * @returns Procedure with the list of card accounts.
 */
export function extractWithWkMap(
  charges: readonly Record<string, unknown>[],
  wk: IWkAccountFields,
): Procedure<readonly IWkAccount[]> {
  if (charges.length === 0) return succeed([]);
  const initial: Procedure<IWkAccount[]> = succeed([]);
  return charges.reduce<Procedure<IWkAccount[]>>(
    (acc, charge): Procedure<IWkAccount[]> => accumulate(acc, charge, wk),
    initial,
  );
}

/**
 * CANONICAL ENTRY POINT:
 * Full pipeline — validate status → discover array → extract fields.
 * Accepts the full PIPELINE_WELL_KNOWN dictionary.
 *
 * Usage:
 *   extract(raw, PIPELINE_WELL_KNOWN)
 *
 * Level 0: findFieldValue(raw, wk.responseStatus)  → BFS status check
 * Level 1: findFirstArray(raw)                      → BFS array discovery
 * Level 2: matchField(charge, wk.queryId)           → WK field extraction
 *
 * @param raw - Raw API response (DashboardMonth or similar).
 * @param wk - WK account fields (pass PIPELINE_WELL_KNOWN directly).
 * @returns Procedure with discovered card accounts.
 */
export function extract(
  raw: Record<string, unknown>,
  wk: IWkAccountFields,
): Procedure<readonly IWkAccount[]> {
  // Level 0: BFS status check — finds 'Status' inside 'Header' without hardcoding the path
  const status = findFieldValue(raw, wk.responseStatus);
  let statusStr = 'missing';
  if (status !== false) statusStr = String(status);
  LOG.debug('extract: responseStatus=%s', statusStr);

  if (statusStr !== API_STATUS_OK) {
    return fail(ScraperErrorTypes.Generic, `API responseStatus: ${statusStr}`);
  }

  // Level 1: BFS array discovery — finds the charge array without knowing its container name
  const items = findFirstArray(raw);
  const charges = items.filter(
    (item): item is JsonObject => typeof item === 'object' && item !== null && !Array.isArray(item),
  );
  LOG.debug('extract: findFirstArray found %d charge objects', charges.length);

  // Level 2: WK field extraction per charge object
  return extractWithWkMap(charges, wk);
}
