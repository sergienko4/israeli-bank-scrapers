/**
 * Yahav native account reads (spec §10.2, AD-Y9): the answer's entities, the
 * BaNCS reference check, the current ILS accounts the accounts read lists,
 * and the match the balance and transaction reads rely on. The match is by
 * account id, and the account numbers must agree when both sides carry one
 * (an empty number is none: the reads send one); the IOR id is ignored
 * because the bank re-issues it between reads. PII-safe: ids are never
 * logged.
 */

import type { ApiRecord } from '../../../Mediator/Scrape/AutoMapperFacade/AutoMapperTypes.js';
import { getIn, isRecord } from '../../../Mediator/Scrape/Bancs/BancsShape.js';
import type {
  ApiBody,
  IExtractAccountsArgs,
} from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { IYahavNativeRef } from './YahavNativePayloads.js';
import type { IYahavAcct } from './YahavShapeHelpers.js';

/** Longest id a BaNCS reference may carry. */
const MAX_REF_LENGTH = 2048;

/** The first printable character code; below it lie control characters. */
const FIRST_PRINTABLE = 0x20;

/** Where an `AccountId` carries the account number. */
const NUMBER_PATH = ['AcctIds', 'BANKACCOUNTID'] as const;

/**
 * The answer's `Payload.DataEntity` records, empty when absent.
 * @param body - Answer body.
 * @returns Entity records.
 */
function yahavEntities(body: ApiBody): readonly ApiRecord[] {
  const entities = getIn(body, ['Payload', 'DataEntity']);
  if (!Array.isArray(entities)) return [];
  return entities.filter(isRecord);
}

/**
 * Whether a character is printable.
 * @param char - One character.
 * @returns True above the control range.
 */
function isPrintable(char: string): boolean {
  return char.charCodeAt(0) >= FIRST_PRINTABLE;
}

/**
 * Whether a value is a usable reference id: bounded text, no control chars.
 * @param value - Candidate id.
 * @returns True when usable.
 */
function isRefText(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > MAX_REF_LENGTH) return false;
  const printable = Array.from(value, isPrintable);
  return printable.every(Boolean);
}

/**
 * A BaNCS reference from its two ids, when both are usable.
 * @param id - Entity id.
 * @param iorId - Entity IOR id.
 * @returns The reference, or false.
 */
function yahavRefOf(id: unknown, iorId: unknown): IYahavNativeRef | false {
  if (!isRefText(id) || !isRefText(iorId)) return false;
  return { id, iorId };
}

/**
 * Whether an account is a current (DDA) account in ILS.
 * @param account - Account record.
 * @returns True for a current ILS account.
 */
function isDdaIls(account: ApiRecord): boolean {
  const type = getIn(account, ['Type', 'CDE']);
  const currency = getIn(account, ['Currency', 'Code', 'CDE']);
  return type === 'DDA' && currency === 'ILS';
}

/**
 * The account number an `AccountId` carries; empty when it carries none.
 * @param identifier - The `AccountId`.
 * @returns The number, or empty text.
 */
function numberIn(identifier: unknown): string {
  if (!isRecord(identifier)) return '';
  const number = getIn(identifier, NUMBER_PATH);
  return typeof number === 'string' ? number : '';
}

/**
 * Whether two account numbers agree: either is unknown, or they are equal.
 * @param sent - The number an answer carries; empty when none.
 * @param known - The account's number; empty when none.
 * @returns False only for two different numbers.
 */
function numbersAgree(sent: string, known: string): boolean {
  return sent === '' || known === '' || sent === known;
}

/**
 * An account's ids and, when the bank sends it, its number.
 * @param account - Account record.
 * @returns The account, or false when its ids are unusable.
 */
function toAcct(account: ApiRecord): IYahavAcct | false {
  const id = getIn(account, ['AccountId', 'Id', 'Id']);
  const iorId = getIn(account, ['AccountId', 'iorId']);
  const ref = yahavRefOf(id, iorId);
  if (ref === false) return false;
  const number = numberIn(account.AccountId);
  return number === '' ? ref : { ...ref, number };
}

/**
 * The account records the accounts answer lists.
 * @param body - Accounts answer body.
 * @returns Account records.
 */
function accountsOf(body: ApiBody): readonly ApiRecord[] {
  const accounts = yahavEntities(body).map(entity => entity.Account);
  return accounts.filter(isRecord);
}

/**
 * The current ILS accounts the accounts answer lists.
 * @param args - Accounts answer.
 * @returns Accounts.
 */
function extractYahavAccounts(args: IExtractAccountsArgs): readonly IYahavAcct[] {
  const current = accountsOf(args.body).filter(isDdaIls);
  const accts = current.map(toAcct);
  return accts.filter((acct): acct is IYahavAcct => acct !== false);
}

/**
 * How many accounts the answer listed before the current-ILS filter.
 * @param args - Accounts answer.
 * @returns Account count.
 */
function countYahavAccounts(args: IExtractAccountsArgs): number {
  return accountsOf(args.body).length;
}

/**
 * Whether an `AccountId` names the account (AD-Y9).
 * @param identifier - The entity's `AccountId`.
 * @param acct - The account.
 * @returns True on the same id, unless both sides carry different numbers.
 */
function isYahavAccountOf(identifier: unknown, acct: IYahavAcct): boolean {
  if (!isRecord(identifier)) return false;
  const id = getIn(identifier, ['Id', 'Id']);
  const sent = numberIn(identifier);
  return id === acct.id && numbersAgree(sent, acct.number ?? '');
}

export default extractYahavAccounts;
export { countYahavAccounts, extractYahavAccounts, isYahavAccountOf, yahavEntities, yahavRefOf };
