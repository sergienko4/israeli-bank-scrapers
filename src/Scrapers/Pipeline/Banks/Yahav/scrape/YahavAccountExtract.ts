/**
 * Yahav BaNCS account extraction — resolves the current DDA account (`id` +
 * `iorId`) from the accounts response (call 0014), where the account sits
 * nested under `Payload.DataEntity[].Account`. Reuses the shared BaNCS getters
 * (`getIn`). The current balance is supplied separately by the dedicated
 * `portfolioBalance` step. PII-safe: account identifiers are never logged.
 */

import type { ApiRecord } from '../../../Mediator/Scrape/AutoMapperFacade/AutoMapperTypes.js';
import { getIn, isRecord, isStr } from '../../../Mediator/Scrape/Bancs/BancsShape.js';
import type { IExtractAccountsArgs } from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { IYahavAcct } from './YahavShapeHelpers.js';

/**
 * Peel `Payload.DataEntity[]` object members (empty when absent).
 * @param body - Accounts response body.
 * @returns DataEntity object members, or empty.
 */
function dataEntities(body: ApiRecord): readonly ApiRecord[] {
  const de = getIn(body, ['Payload', 'DataEntity']);
  if (!Array.isArray(de)) return [];
  return de.filter(isRecord);
}

/**
 * Read one member's nested `Account.AccountId` block (or empty).
 * @param member - DataEntity member.
 * @returns AccountId record, or empty record.
 */
function accountIdOf(member: ApiRecord): ApiRecord {
  const node = getIn(member, ['Account', 'AccountId']);
  return isRecord(node) ? node : {};
}

/**
 * Build one account ref from a DataEntity member; `false` when incomplete.
 * @param member - DataEntity member.
 * @returns Yahav account ref, or `false`.
 */
function toAcct(member: ApiRecord): IYahavAcct | false {
  const aid = accountIdOf(member);
  const id = getIn(aid, ['Id', 'Id']);
  const iorId = aid.iorId;
  if (!isStr(id) || !isStr(iorId)) return false;
  return { id, iorId };
}

/**
 * Extract the current DDA account(s) from the BaNCS accounts response.
 * @param args - Bundle carrying the accounts response body.
 * @returns Resolved Yahav account refs (usually one).
 */
export function extractYahavAccounts(args: IExtractAccountsArgs): readonly IYahavAcct[] {
  const members = dataEntities(args.body);
  const mapped = members.map(toAcct);
  return mapped.filter((a): a is IYahavAcct => a !== false);
}

export default extractYahavAccounts;
