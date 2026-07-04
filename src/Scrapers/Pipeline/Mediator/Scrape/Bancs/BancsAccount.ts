/**
 * BaNCS account resolution — recognizes the single current DDA account
 * inside a TCS BaNCS account-resolve body (`Payload.DataEntity[]`).
 *
 * <p>Two-part shape guard: a member qualifies only when it carries BOTH
 * a top-level `AccountId.AcctIds.IBAN` string AND a top-level
 * `BalanceList[]` with a `CURRENT` BalType. That pair uniquely selects
 * the current-account record and deliberately excludes:
 * <ul>
 *   <li>the `portfolioBalance` response (members wrapped in `.Account`,
 *       no top-level IBAN, AVAILABLE-only) — else the picker would pick
 *       the larger container and emit many wrong accounts;</li>
 *   <li>transaction rows (top-level IBAN but no `BalanceList`).</li>
 * </ul>
 *
 * <p>Default-deny: {@link selectBancsAccountRecords} /
 * {@link selectBancsAccountIds} return `false` for every other body, so
 * the generic container / root-array discovery in
 * {@link "../AccountExtractor/AccountExtractor.js"} runs unchanged for
 * the other pipeline banks (Leumi/Discount/VisaCal/Max/Isracard).
 *
 * <p>PII-safe: BANKACCOUNTID / IBAN are financial identifiers and are
 * NEVER logged here — the module is a pure selector with no log sink.
 */

import type { ApiRecord } from '../AutoMapperFacade/AutoMapperTypes.js';
import { getIn, isCurrentBalType, isRecord, isStr } from './BancsShape.js';

/** Path to the shared BaNCS query id (also carried by txn rows). */
const BANKACCOUNTID_PATH = ['AccountId', 'AcctIds', 'BANKACCOUNTID'];

/** Path to the top-level IBAN present only on real account records. */
const IBAN_PATH = ['AccountId', 'AcctIds', 'IBAN'];

/**
 * Whether a member owns a top-level `BalanceList[]` with a CURRENT entry.
 * @param member - Candidate DataEntity member.
 * @returns True when a CURRENT balance is present at the member level.
 */
function hasCurrentBalance(member: ApiRecord): boolean {
  const list = member.BalanceList;
  if (!Array.isArray(list)) return false;
  const records = list.filter(isRecord);
  return records.some(isCurrentBalType);
}

/**
 * Two-part guard — top-level IBAN string AND a CURRENT BalanceList.
 * @param member - Candidate DataEntity member.
 * @returns True when the member is the current DDA account record.
 */
function isCurrentDdaAccount(member: ApiRecord): boolean {
  const iban = getIn(member, IBAN_PATH);
  if (!isStr(iban)) return false;
  return hasCurrentBalance(member);
}

/**
 * Peel `Payload.DataEntity[]` records from a body (empty when absent).
 * @param body - Captured response body.
 * @returns DataEntity object members, or empty.
 */
function dataEntities(body: ApiRecord): readonly ApiRecord[] {
  const de = getIn(body, ['Payload', 'DataEntity']);
  if (!Array.isArray(de)) return [];
  return de.filter(isRecord);
}

/**
 * The current DDA account members matched by the two-part guard.
 * @param body - Captured response body.
 * @returns Matching account members (usually one), or empty.
 */
function ddaAccounts(body: ApiRecord): readonly ApiRecord[] {
  const members = dataEntities(body);
  return members.filter(isCurrentDdaAccount);
}

/**
 * Read one member's `BANKACCOUNTID` query id, or empty when absent.
 * @param member - Matched account member.
 * @returns The BANKACCOUNTID string, or empty string.
 */
function bankAccountId(member: ApiRecord): string {
  const id = getIn(member, BANKACCOUNTID_PATH);
  if (!isStr(id)) return '';
  return id;
}

/**
 * Select the BaNCS current DDA account record(s) from a response body.
 * @param body - Captured response body (any JSON object shape).
 * @returns The matching account record(s), or `false` (default-deny).
 */
function selectBancsAccountRecords(body: ApiRecord): readonly ApiRecord[] | false {
  const accounts = ddaAccounts(body);
  if (accounts.length === 0) return false;
  return accounts;
}

/**
 * Select the BaNCS current DDA account query id(s) from a response body.
 * @param body - Captured response body (any JSON object shape).
 * @returns The BANKACCOUNTID id(s), or `false` (default-deny).
 */
function selectBancsAccountIds(body: ApiRecord): readonly string[] | false {
  const accounts = ddaAccounts(body);
  const ids = accounts.map(bankAccountId).filter(Boolean);
  if (ids.length === 0) return false;
  return ids;
}

export { selectBancsAccountIds, selectBancsAccountRecords };
