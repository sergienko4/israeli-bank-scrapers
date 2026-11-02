/**
 * Telebank group scrape shape — the check every Titan answer passes before the
 * shape reads it (spec §11.2). An answer must be an object with no
 * `actionRequired`, `Error` or `error` set to anything but null. An
 * accounts answer must list 1 to 8 accounts whose ids are unique and safe
 * to put in a URL path; a transactions answer must carry its entries as a
 * list of records. A balance answer has no rule of its own: its reader
 * already falls back to 0 (DN3).
 *
 * <p>The driver hands the check no step, so the rules key on the container
 * an answer carries. An answer that carries neither container passes: an
 * accounts answer without one reads as no accounts, which fails the run at
 * the phase's zero-accounts floor, and a transactions answer without one
 * reads as no entries. Every refusal is `Generic` and never quotes the bank's text.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, succeed } from '../../../Types/Procedure.js';
import type { ApiBody } from '../IApiDirectScrapeShape.js';

/** Most accounts one run reads — the bank's per-login call budget. */
const MAX_ACCOUNTS = 8;

/** A Titan account id: the URL path segment the balance and entries reads use. */
const ACCOUNT_ID = /^[\w-]{1,128}$/;

/** Why a Titan answer was refused — the error message of each refusal. */
const TITAN_REFUSAL = {
  notObject: 'titan answer not an object',
  actionRequired: 'titan answer action required',
  error: 'titan answer error',
  accounts: 'titan accounts unverified',
  accountIds: 'titan account ids invalid',
  budget: 'titan accounts over budget',
  txns: 'titan transactions unverified',
} as const;

/** A check's verdict: pass, or the refusal it gives. */
type TitanVerdict = 'ok' | keyof typeof TITAN_REFUSAL;

/** A rule for one container an answer carries. */
type ContainerRule = (container: unknown) => TitanVerdict;

/**
 * Whether a value is a JSON object (not null, not an array).
 * @param value - Any value.
 * @returns True for a record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether a field holds anything but null — the bank's mark of a refusal.
 * @param value - Field value.
 * @returns True when the field is set.
 */
function isSet(value: unknown): boolean {
  return value !== undefined && value !== null;
}

/**
 * The verdict of the fields every Titan answer may carry.
 * @param body - The answer.
 * @returns `ok`, or the envelope refusal.
 */
function envelopeVerdict(body: ApiBody): TitanVerdict {
  if (!isRecord(body)) return 'notObject';
  if (isSet(body.actionRequired)) return 'actionRequired';
  if (isSet(body.Error) || isSet(body.error)) return 'error';
  return 'ok';
}

/**
 * One account row's id.
 * @param row - Raw `UserAccounts` row.
 * @returns `NewAccountInfo.AccountID`, or '' (never a valid id) when the row
 * has none.
 */
function accountIdOf(row: unknown): unknown {
  if (!isRecord(row) || !isRecord(row.NewAccountInfo)) return '';
  return row.NewAccountInfo.AccountID;
}

/**
 * Whether a value is a usable Titan account id.
 * @param value - Candidate id.
 * @returns True for a 1–128 char string of letters, digits, `_` and `-`.
 */
function isAccountId(value: unknown): boolean {
  return typeof value === 'string' && ACCOUNT_ID.test(value);
}

/**
 * The verdict on an accounts container.
 * @param container - `UserAccountsData`.
 * @returns `ok` for 1 to 8 rows of unique valid ids.
 */
function accountsVerdict(container: unknown): TitanVerdict {
  const rows = isRecord(container) ? container.UserAccounts : undefined;
  if (!Array.isArray(rows) || rows.length === 0) return 'accounts';
  const ids = rows.map(accountIdOf);
  const isUnique = new Set(ids).size === ids.length;
  if (!isUnique || !ids.every(isAccountId)) return 'accountIds';
  return ids.length > MAX_ACCOUNTS ? 'budget' : 'ok';
}

/**
 * The verdict on a transactions container.
 * @param container - `CurrentAccountLastTransactions`.
 * @returns `ok` when `OperationEntry` is a list of records.
 */
function txnsVerdict(container: unknown): TitanVerdict {
  const rows = isRecord(container) ? container.OperationEntry : undefined;
  const isRecordList = Array.isArray(rows) && rows.every(isRecord);
  return isRecordList ? 'ok' : 'txns';
}

/** The rule of each container an answer may carry. */
const CONTAINER_RULES: Readonly<Record<string, ContainerRule>> = {
  UserAccountsData: accountsVerdict,
  CurrentAccountLastTransactions: txnsVerdict,
};

/**
 * The first refusal among the containers an answer carries.
 * @param body - An answer whose envelope passed.
 * @returns `ok` when every container present passes.
 */
function containersVerdict(body: ApiBody): TitanVerdict {
  const present = Object.keys(CONTAINER_RULES).filter((key): boolean => Object.hasOwn(body, key));
  const verdicts = present.map((key): TitanVerdict => CONTAINER_RULES[key](body[key]));
  return verdicts.find((verdict): boolean => verdict !== 'ok') ?? 'ok';
}

/**
 * Fail a Titan answer the bank refused or that the shape cannot trust.
 * @param body - Successful response body.
 * @returns The body, or a Generic failure naming the refusal.
 */
function checkTitanBody(body: ApiBody): Procedure<ApiBody> {
  const envelope = envelopeVerdict(body);
  const verdict = envelope === 'ok' ? containersVerdict(body) : envelope;
  if (verdict === 'ok') return succeed(body);
  return fail(ScraperErrorTypes.Generic, TITAN_REFUSAL[verdict]);
}

export default checkTitanBody;
export { checkTitanBody };
