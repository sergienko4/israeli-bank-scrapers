/**
 * Scrape POST-body templating — scalar WK identifier substitution +
 * plural cards-array narrowing. Drained from `ScrapeDataActions.ts`
 * during the Phase 12e file-size split; `templatePostBody` is
 * re-exported verbatim from the barrel facade.
 */

import { findFieldValue, replaceField } from '../../../Mediator/Scrape/ScrapeAutoMapper.js';
import type { JsonRecord } from '../../../Mediator/Scrape/ScrapeReplayAction.js';
import {
  PIPELINE_WELL_KNOWN_ACCOUNT_FIELDS as WK_ACCT,
  PIPELINE_WELL_KNOWN_MONTHLY_FIELDS as MF,
} from '../../../Registry/WK/ScrapeWK.js';
import type { Brand } from '../../../Types/Brand.js';

/** Lowercased templateable WK key. */
type TemplateKeyLower = Brand<string, 'TemplateKeyLower'>;
/** Templateable-key predicate result. */
type IsTemplateKey = Brand<boolean, 'IsTemplateKey'>;
/** Field-application predicate result. */
type DidApplyField = Brand<boolean, 'DidApplyField'>;

/** Lowercased WK account ID field names. */
const TEMPLATE_KEYS = new Set(
  WK_ACCT.id.map((k): TemplateKeyLower => k.toLowerCase() as TemplateKeyLower),
);

/**
 * Check if a field key is a templateable account ID.
 * @param key - Field name.
 * @returns True if the key matches a WK account ID field.
 */
function isTemplateKey(key: string): IsTemplateKey {
  const keyLower = key.toLowerCase();
  return TEMPLATE_KEYS.has(keyLower as TemplateKeyLower) as IsTemplateKey;
}

/**
 * Apply one account record entry to the body if templateable.
 * @param body - Body to mutate.
 * @param key - Field name from account record.
 * @param value - Field value (only string/number are used).
 * @returns True if field was applied.
 */
function applyTemplateField(
  body: Record<string, string | object>,
  key: string,
  value: string | number,
): DidApplyField {
  if (!isTemplateKey(key)) return false as DidApplyField;
  const stringValue = String(value);
  replaceField(body as JsonRecord, [key], stringValue);
  return true as DidApplyField;
}

/**
 * Extract scalar entries from an account record.
 * @param record - Account record with mixed values.
 * @returns Only string/number entries.
 */
function scalarEntries(record: Record<string, unknown>): readonly [string, string | number][] {
  const all = Object.entries(record);
  return all.filter(
    (e): e is [string, string | number] => typeof e[1] === 'string' || typeof e[1] === 'number',
  );
}

/** Plural-array WK keys identifying multi-card request scopes. */
const PLURAL_CARDS_KEYS = ['cards', 'accounts', 'bankAccounts'] as const;

/** Per-txn WK card-id alias union — same union used by the partition. */
const PER_TXN_CARD_FIELDS: readonly string[] = [
  ...WK_ACCT.queryId,
  ...WK_ACCT.displayId,
  ...MF.accountId,
];

/** Local alias for an opaque card-array entry — bypass `unknown` rule. */
type CardEntry = Record<string, unknown> | string | number | boolean | null;

/** Did-filter outcome — branded so Rule #15 accepts the boolean return. */
type DidFilter = Brand<boolean, 'DidFilter'>;

/** Mutable POST body — local alias to keep helper signatures terse. */
type MutBody = Record<string, unknown>;

/**
 * Returns true when one card-array entry's WK card-id field matches
 * the iteration's accountId. Generic via the WK alias list — case-
 * insensitive key matching is delegated to {@link findFieldValue}.
 *
 * @param entry - One element of the plural cards array.
 * @param accountId - Iteration card identifier.
 * @returns true when the entry belongs to this card.
 */
function entryMatchesAccountId(entry: CardEntry, accountId: string): boolean {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return false;
  }
  const value = findFieldValue(entry, PER_TXN_CARD_FIELDS);
  if (value === false) return false;
  return String(value) === accountId;
}

/**
 * Filters the array under one plural key to entries matching
 * `accountId`. Returns true only when the filter actually narrowed the
 * array (some — but not all — entries matched). Hoisted so
 * {@link filterPluralCardArrays} stays at depth 1.
 *
 * @param body - Mutable POST body.
 * @param key - Plural key to inspect.
 * @param accountId - Iteration card identifier.
 * @returns true when the array under `key` was rewritten.
 */
function filterOnePluralKey(body: MutBody, key: string, accountId: string): DidFilter {
  const arr = body[key];
  if (!Array.isArray(arr)) return false as DidFilter;
  const matched = arr.filter((e): boolean => entryMatchesAccountId(e as CardEntry, accountId));
  if (matched.length === 0 || matched.length === arr.length) return false as DidFilter;
  body[key] = matched;
  return true as DidFilter;
}

/**
 * Rewrites every plural cards array in `body` to contain only the
 * entry matching `accountId`. Banks whose dashboard fires a single
 * multi-card POST (Amex/Isracard `GetLatestTransactions`) accept a
 * one-element array equally well — the bank then returns per-card
 * data per request, eliminating the response-side mirror without
 * any per-bank code.
 *
 * <p>Generic via {@link PLURAL_CARDS_KEYS} (cards/accounts/
 * bankAccounts) and the WK card-id alias union. No-op when the body
 * carries no plural array, when no entry matches the accountId, or
 * when the accountId is empty (single-account banks).
 *
 * @param body - Mutable POST body parsed from the captured template.
 * @param accountId - Iteration card identifier (empty = no filter).
 * @returns true when at least one plural array was narrowed.
 */
function filterPluralCardArrays(body: Record<string, unknown>, accountId: string): DidFilter {
  if (accountId.length === 0) return false as DidFilter;
  const outcomes = PLURAL_CARDS_KEYS.map(
    (key): DidFilter => filterOnePluralKey(body, key, accountId),
  );
  return outcomes.includes(true as DidFilter) as DidFilter;
}

/**
 * Substitute scalar WK identifier fields from `accountRecord` into the
 * POST `body` via the replaceField walker, then return the same body.
 * @param body - Mutable POST body to substitute into.
 * @param accountRecord - Account record supplying scalar field values.
 * @returns The same `body`, with scalar WK fields substituted.
 */
function applyScalarFields(
  body: Record<string, string | object>,
  accountRecord: Record<string, unknown>,
): Record<string, string | object> {
  for (const [key, value] of scalarEntries(accountRecord)) {
    applyTemplateField(body, key, value);
  }
  return body;
}

/**
 * Build POST body from captured template.
 *
 * <p>Two-step rewrite: first filter any plural cards/accounts array
 * to the iteration's card (so multi-card request templates become
 * per-card requests, generic via {@link PLURAL_CARDS_KEYS}); then
 * substitute scalar WK identifiers via the existing replaceField
 * walker.
 *
 * @param postData - Captured raw POST data string.
 * @param accountRecord - Account record with values.
 * @param accountId - Iteration card identifier; drives the plural-
 *   array filter. Optional — when omitted, only scalar substitution
 *   runs (single-card banks).
 * @returns Templated body with account IDs substituted and plural
 *   arrays narrowed to the iteration's card when applicable.
 */
function templatePostBody(
  postData: string,
  accountRecord: Record<string, unknown>,
  accountId = '',
): Record<string, string | object> {
  const body = JSON.parse(postData || '{}') as Record<string, unknown>;
  filterPluralCardArrays(body, accountId);
  return applyScalarFields(body as Record<string, string | object>, accountRecord);
}

export default templatePostBody;
