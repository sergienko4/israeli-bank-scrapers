/**
 * Generic scrape strategy — auto-maps API responses.
 * Banks provide ZERO mapping code. The mediator discovers
 * field names automatically via BFS iterative search.
 */

import type { ITransaction } from '../../../../Transactions.js';
import { TransactionStatuses, TransactionTypes } from '../../../../Transactions.js';
import {
  PIPELINE_WELL_KNOWN_ACCOUNT_FIELDS as WK_ACCT,
  PIPELINE_WELL_KNOWN_API as WK_API,
  PIPELINE_WELL_KNOWN_BILLING as WK_BILLING,
  PIPELINE_WELL_KNOWN_TXN_FIELDS as WK,
} from '../../Registry/WK/ScrapeWK.js';
import { getDebug } from '../../Types/Debug.js';
import type {
  ITxnEndpoint,
  ITxnEndpointInternal,
  ITxnFieldMap,
} from '../../Types/PipelineContext.js';
import type { INetworkDiscovery } from '../Network/NetworkDiscovery.js';
import {
  type ApiRecord,
  DEFAULT_CURRENCY,
  type ScalarFieldHit,
  type UntypedValue,
} from './AutoMapperFacade/AutoMapperTypes.js';
import {
  findAllFieldValues,
  findFieldValue,
  flattenObjectTree,
  isSearchableObject,
  matchField,
} from './BfsFieldSearch/BfsFieldSearch.js';
import { castSearchable } from './BfsFieldSearch/TxnSignature.js';
import { coerceNumber, coerceString, parseAutoDate } from './Coercion/Coercion.js';
import findFirstArray from './FieldHunt/LifoCrawl.js';
import huntTransactions from './FieldHunt/TxnHunt.js';

export type { IMonthChunk } from '../Scrape/ScrapeReplayAction.js';
export {
  buildMonthBody,
  generateMonthChunks,
  isMonthlyEndpoint,
  isRangeIterable,
  replaceField,
} from '../Scrape/ScrapeReplayAction.js';

const LOG = getDebug(import.meta.url);

/**
 * Coerce a `findFieldValue` hit to a usable per-txn identifier.
 *
 * <p>Accepts both numeric IDs (Beinleumi `reference`, Hapoalim
 * `referenceNumber`) and string IDs (Isracard `confirmationNumber` =
 * `"252890416:42"`, Max `uid` = `"26050809581827413972659"`, Discount
 * `Urn`, VisaCal `trnIntId`). Rejects the sentinel placeholder values
 * Beinleumi emits on pending out-of-statement rows (`0`, empty string)
 * so the identifier never collides with a real one in the dedup hash.
 *
 * <p>Phase F gap closed (2026-05-13): the prior implementation
 * returned `false` for every string input, silently dropping the
 * identifier for Isracard / Amex / Max / Discount / VisaCal.
 *
 * @param val - Raw field value from {@link findFieldValue}.
 * @returns The identifier preserved as-is when usable, `false` when
 *   the value is a sentinel placeholder.
 */
function coerceIdentifier(val: ScalarFieldHit): string | number | false {
  if (typeof val === 'number') return val;
  if (typeof val === 'string' && val.length > 0 && val !== '0') return val;
  return false;
}

// KNOWN_DATE_FORMATS imported from Registry/WK/ScrapeWK.ts

/** Shekel currency aliases from WK. */
const SHEKEL_ALIASES = new Set(WK.shekelAliases);

/**
 * Normalize currency — convert shekel aliases to standard ILS.
 * @param raw - Raw currency string.
 * @returns Normalized currency code.
 */
function normalizeCurrency(raw: string): string {
  if (SHEKEL_ALIASES.has(raw)) return 'ILS';
  return raw;
}

/**
 * Check if a raw transaction is voided/summary (should be filtered out).
 * Matches old scraper's filterValidTransactions logic:
 * dealSumType === '1' is voided, voucherNumberRatz === '000000000' is invalid.
 * @param raw - Raw transaction record.
 * @returns True if the transaction should be excluded.
 */
function isVoidedTransaction(raw: ApiRecord): boolean {
  const voidVal = findFieldValue(raw, WK.voidIndicators);
  if (voidVal === '1') return true;
  const voucher = findFieldValue(raw, WK.voucherFields);
  if (voucher === '000000000') return true;
  return false;
}

/**
 * Negate amount for card transactions (charges are debits).
 * Isracard/Amex report positive amounts for charges — old scraper negates them.
 * @param amount - Raw amount from API.
 * @param isCardTxn - Whether this is a card company transaction.
 * @returns Negated amount for cards, original for banks.
 */
function maybeNegateAmount(amount: number, isCardTxn: boolean): number {
  if (!isCardTxn) return amount;
  if (amount === 0) return 0;
  return -Math.abs(amount);
}

/**
 * Resolve amount — single field or split debit/credit netting.
 * Generic: if WK.amount not found, falls back to credit - debit.
 * @param raw - Raw transaction record.
 * @param singleAmount - Result of findFieldValue(raw, WK.amount).
 * @returns Resolved numeric amount.
 */
function resolveAmount(raw: ApiRecord, singleAmount: ScalarFieldHit): number {
  if (singleAmount !== false) return coerceNumber(singleAmount, 0);
  const debit = findFieldValue(raw, WK.debitAmount);
  const credit = findFieldValue(raw, WK.creditAmount);
  const debitNum = coerceNumber(debit, 0);
  const creditNum = coerceNumber(credit, 0);
  return creditNum - debitNum;
}

/**
 * Apply WK.direction sign convention. Debit indicators flip a positive
 * amount to negative; missing / non-debit directions leave the amount untouched.
 * @param raw - Raw transaction record.
 * @param amount - Amount already resolved via resolveAmount + maybeNegateAmount.
 * @returns Sign-corrected amount.
 */
function applyDirectionWk(raw: ApiRecord, amount: number): number {
  const direction = findFieldValue(raw, WK.direction);
  if (typeof direction !== 'string') return amount;
  if (!/^debit$/i.test(direction)) return amount;
  return -Math.abs(amount);
}

/**
 * Validate a mapped txn before it leaves the auto-mapper.
 * Rejects records with empty date or NaN amount — these would silently
 * drop later in deduplicateTxns / downstream consumers.
 * @param dateIso - Coerced date string (ISO or passthrough).
 * @param amount - Coerced charged amount.
 * @returns True when txn has the minimum required fields.
 */
function isMappableTxn(dateIso: string, amount: number): boolean {
  if (dateIso === '') return false;
  if (!Number.isFinite(amount)) return false;
  const ms = new Date(dateIso).getTime();
  if (Number.isNaN(ms)) return false;
  return true;
}

/**
 * Map a raw API record to a standard ITransaction.
 * Returns false when required fields (date / amount) cannot be coerced,
 * so the extractor can drop the record with a LOUD log instead of
 * letting an empty-date / NaN-amount txn propagate silently.
 * @param raw - Raw transaction record from API response.
 * @returns Mapped transaction, or false on malformed record.
 */
function autoMapTransaction(raw: ApiRecord): ITransaction | false {
  const date = findFieldValue(raw, WK.date);
  const processedDate = findFieldValue(raw, WK.processedDate);
  const amount = findFieldValue(raw, WK.amount);
  const originalAmount = findFieldValue(raw, WK.originalAmount);
  const description = findFieldValue(raw, WK.description);
  const identifier = findFieldValue(raw, WK.identifier);
  const currency = findFieldValue(raw, WK.currency);
  const dateStr = coerceString(date, parseAutoDate);
  const procStr = coerceString(processedDate, parseAutoDate, dateStr);
  const voidField = findFieldValue(raw, WK.voidIndicators);
  const isCard = Boolean(voidField);
  const rawAmt = resolveAmount(raw, amount);
  const negAmt = maybeNegateAmount(rawAmt, isCard);
  const amtNum = applyDirectionWk(raw, negAmt);
  if (!isMappableTxn(dateStr, amtNum)) {
    const why = `date="${dateStr}", amount=${String(amtNum)}`;
    LOG.debug({ message: `autoMapTransaction: rejected (${why})` });
    return false;
  }
  const rawOrig = coerceNumber(originalAmount, amtNum);
  const negOrig = maybeNegateAmount(rawOrig, isCard);
  const origNum = applyDirectionWk(raw, negOrig);
  const descStr = coerceString(description);
  const rawCurr = coerceString(currency, undefined, DEFAULT_CURRENCY);
  const currStr = normalizeCurrency(rawCurr);
  const rawId = coerceIdentifier(identifier);
  const idVal = rawId || undefined;
  return {
    type: TransactionTypes.Normal,
    date: dateStr,
    processedDate: procStr,
    originalAmount: origNum,
    originalCurrency: currStr,
    chargedAmount: amtNum,
    description: descStr,
    status: TransactionStatuses.Completed,
    identifier: idVal,
  };
}

/** Preview length for the raw body trace dump. */
const BODY_PREVIEW_CHARS = 4096;

/**
 * Stringify a response body, returning a short failure marker on throw.
 * @param body - API body.
 * @returns Full JSON or '<unstringifiable>'.
 */
function safeStringify(body: ApiRecord): string {
  try {
    return JSON.stringify(body);
  } catch {
    return '<unstringifiable>';
  }
}

/**
 * Truncate a JSON string for trace dumps.
 * @param json - Full JSON string.
 * @returns Truncated preview.
 */
function truncatePreview(json: string): string {
  if (json.length <= BODY_PREVIEW_CHARS) return json;
  return `${json.slice(0, BODY_PREVIEW_CHARS)}…`;
}

/**
 * Trace-dump the raw response shape when extraction fails. Helps diagnose
 * bank-specific API formats (e.g. Hapoalim) without stopping the pipeline.
 * @param responseBody - The raw API body that yielded zero items.
 * @returns Always true (side-effect only).
 */
function traceRawShape(responseBody: ApiRecord): true {
  const topLevelKeys = Object.keys(responseBody);
  const json = safeStringify(responseBody);
  const preview = truncatePreview(json);
  LOG.trace({
    message: 'extractAccountRecords: 0 items — raw body shape',
    topLevelKeys,
    preview,
  });
  return true;
}

/**
 * Check if a value is a plain object with at least one
 * `WK_ACCT.id` field (any of the queryId / displayId aliases).
 * Used to recognize account-shape records that don't carry
 * txn-signature fields (e.g. Hapoalim's /general/accounts:
 * `[{bankNumber,branchNumber,accountNumber,…}]`).
 * @param v - Candidate value.
 * @returns True when v looks like an account record.
 */
function looksLikeAccountRecord(v: UntypedValue): boolean {
  if (!isSearchableObject(v)) return false;
  const hit = findFieldValue(v as ApiRecord, WK_ACCT.id);
  return hit !== false;
}

/**
 * Root-array fallback: if the response body is already an array of
 * account-shaped records, return it directly. Covers responses like
 * Hapoalim's /general/accounts which is [{bankNumber,accountNumber,…}]
 * at root with no txn-signature fields to trip findFirstArray.
 * @param responseBody - Parsed JSON response body.
 * @returns Root array of account records, or empty.
 */
function rootAccountArray(responseBody: ApiRecord): readonly ApiRecord[] {
  if (!Array.isArray(responseBody)) return [];
  const arr = responseBody as readonly unknown[];
  if (arr.length === 0) return [];
  if (!looksLikeAccountRecord(arr[0])) return [];
  return arr.filter(looksLikeAccountRecord).map((v): ApiRecord => v as ApiRecord);
}

/**
 * Extracts every WK named container reachable from `responseBody` and
 * returns them keyed by container name. Phase 7d adds this helper so
 * ACCOUNT-RESOLVE.POST can commit BOTH `cards` AND `bankAccounts`
 * found in the same VisaCal `account/init` payload (the legacy
 * `findContainerArray` returned only the first match).
 *
 * <p>Container names that are absent from the body, or present but
 * empty after the {@link looksLikeAccountRecord} filter, are omitted
 * from the returned object entirely (so consumers can `Object.keys`
 * for a clean per-container count without zero-length entries).
 *
 * @param responseBody - Parsed JSON response body.
 * @returns Map of container-name → records. Empty when no WK
 *   container surfaced any account-shape records.
 */
/** Per-record key index built once per record (preserves casing). */
interface IRecordKeyIndex {
  readonly originalKeys: readonly string[];
  readonly lowerKeys: readonly string[];
}

/**
 * Build a per-record key index — pairs original-case keys with
 * lower-cased copies so each suffix probe avoids re-casing.
 * @param record - Object whose keys to index.
 * @returns Key index.
 */
function indexRecordKeys(record: ApiRecord): IRecordKeyIndex {
  const originalKeys = Object.keys(record);
  const lowerKeys = originalKeys.map((k): string => k.toLowerCase());
  return { originalKeys, lowerKeys };
}

/**
 * Filter the array under `record[originalKey]` to account-shape
 * records only. Returns the empty array when the value is not a
 * non-empty array of account-shape records — caller skips assigning.
 * @param record - Parent record.
 * @param originalKey - Key into the record.
 * @returns Account-shape records, possibly empty.
 */
function pickAccountObjectsFromKey(record: ApiRecord, originalKey: string): readonly ApiRecord[] {
  const value = record[originalKey];
  if (!Array.isArray(value) || value.length === 0) return [];
  const filtered = value.filter(looksLikeAccountRecord);
  return filtered.map((v): ApiRecord => v as ApiRecord);
}

/** Per-WK probe outcome — successful claim or skip-with-reason. */
interface IClaimAttempt {
  readonly claimedLowerKey: string | false;
  readonly objects: readonly ApiRecord[];
}

const NO_CLAIM: IClaimAttempt = { claimedLowerKey: false, objects: [] };

/** Bundled args for {@link probeContainerForWk}. */
interface IProbeArgs {
  readonly record: ApiRecord;
  readonly keys: IRecordKeyIndex;
  readonly wantedLower: string;
  readonly claimedLower: ReadonlySet<string>;
}

/**
 * Probe one record for the longest-suffix match of `wantedLower`
 * among unclaimed keys. Returns the claim metadata so the caller
 * mutates `assigned` and `claimedKeys` in one place — keeps the
 * loop body shallow per the project's max-depth=1 rule.
 * @param args - Bundled probe args (record, keys, wantedLower, claimedLower).
 * @returns Claim attempt metadata.
 */
function probeContainerForWk(args: IProbeArgs): IClaimAttempt {
  const matchIdx = args.keys.lowerKeys.findIndex(
    (lk): boolean => !args.claimedLower.has(lk) && lk.endsWith(args.wantedLower),
  );
  if (matchIdx < 0) return NO_CLAIM;
  const originalKey = args.keys.originalKeys[matchIdx];
  const objects = pickAccountObjectsFromKey(args.record, originalKey);
  if (objects.length === 0) return NO_CLAIM;
  return { claimedLowerKey: args.keys.lowerKeys[matchIdx], objects };
}

/**
 * Walks `responseBody` once and assigns each PHYSICAL record-key
 * to the LONGEST WK name that suffix-matches it. Returns the
 * mutated `assigned` map so callers chain rather than rely on
 * implicit mutation. Without longest-match-wins, the suffix-matcher
 * in {@link tryContainerInRecord} would attribute the same
 * `bankAccounts` array to BOTH `accounts` (suffix hit) AND
 * `bankAccounts` (full hit), double-counting every record.
 *
 * @param record - One record from the body's flattened tree.
 * @param wkNames - WK container names sorted longest-first.
 * @param assigned - Per-WK-name records, mutated in place.
 * @returns The same `assigned` object (chain-friendly).
 */
/** Bundled args for {@link applyClaimAttempt} so the call stays flat. */
interface IApplyArgs {
  readonly attempt: IClaimAttempt;
  readonly wkName: string;
  readonly assigned: Record<string, ApiRecord[]>;
  readonly claimed: Set<string>;
}

/**
 * Apply one probe outcome — claim the lower-cased key and append
 * extracted records to the per-WK bucket. No-op when the attempt
 * surfaced no claim. Pulled out so the per-WK loop in
 * {@link assignContainersInRecord} stays flat (max-depth=1).
 * @param args - Bundled apply args.
 * @returns The same `assigned` map (chain-friendly).
 */
function applyClaimAttempt(args: IApplyArgs): Record<string, ApiRecord[]> {
  if (args.attempt.claimedLowerKey === false) return args.assigned;
  args.claimed.add(args.attempt.claimedLowerKey);
  const bucket = args.assigned[args.wkName] ?? [];
  bucket.push(...args.attempt.objects);
  args.assigned[args.wkName] = bucket;
  return args.assigned;
}

/**
 * Walks `record` once and assigns each PHYSICAL key to the LONGEST
 * WK name that suffix-matches it. Without longest-match-wins, the
 * suffix-matcher would attribute the same `bankAccounts` array to
 * BOTH `accounts` (suffix hit) AND `bankAccounts` (full hit),
 * double-counting every record. Returns the mutated `assigned` map
 * so callers can chain.
 * @param record - One record from the body's flattened tree.
 * @param wkNames - WK container names sorted longest-first.
 * @param assigned - Per-WK-name records, mutated in place.
 * @returns The same `assigned` object (chain-friendly).
 */
function assignContainersInRecord(
  record: ApiRecord,
  wkNames: readonly string[],
  assigned: Record<string, ApiRecord[]>,
): Record<string, ApiRecord[]> {
  const keys = indexRecordKeys(record);
  const claimed = new Set<string>();
  for (const wkName of wkNames) {
    const wantedLower = wkName.toLowerCase();
    const attempt = probeContainerForWk({ record, keys, wantedLower, claimedLower: claimed });
    applyClaimAttempt({ attempt, wkName, assigned, claimed });
  }
  return assigned;
}

/**
 * Extracts every WK named container reachable from `responseBody`
 * and returns them keyed by container name. Phase 7d adds this
 * helper so ACCOUNT-RESOLVE.POST can commit BOTH `cards` AND
 * `bankAccounts` found in the same VisaCal `account/init` payload
 * (the legacy `findContainerArray` returned only the first match).
 * @param responseBody - Parsed JSON response body.
 * @returns Per-WK-name container map; absent containers omitted.
 */
function extractAllContainers(
  responseBody: ApiRecord,
): Readonly<Record<string, readonly ApiRecord[]>> {
  const wkLongestFirst = [...WK_ACCT.containers].sort((a, b): number => b.length - a.length);
  const assigned: Record<string, ApiRecord[]> = {};
  const allRecords = flattenObjectTree(responseBody);
  for (const r of allRecords) assignContainersInRecord(r, wkLongestFirst, assigned);
  return assigned;
}

/**
 * Extract account records from API response. Logs the response shape
 * at trace level when zero items are found — exposes per-bank mapper
 * gaps. Tries three extractors in order:
 *
 * <ol>
 *   <li>{@link extractAllContainers} (named WK_ACCT.containers —
 *       cardsList, cards, accounts, bankAccounts; covers card-family
 *       banks where the cards array carries no txn-signature fields).
 *       Concatenates ALL surfaced containers — Phase 7d change.</li>
 *   <li>{@link findFirstArray} (txn-signature BFS — covers banks
 *       whose account response has txn preview arrays).</li>
 *   <li>{@link rootAccountArray} (root-level array of account-shaped
 *       records — covers Hapoalim's /general/accounts).</li>
 * </ol>
 *
 * @param responseBody - Parsed JSON response body.
 * @returns Account records with all original fields.
 */
/**
 * Concatenate every container's records and emit the per-container
 * trace line. Extracted helper so {@link extractAccountRecords}
 * stays inside the project's cognitive-complexity ceiling.
 * @param containers - Per-WK-name container split.
 * @returns Concatenated records across every container.
 */
function flattenContainersForLog(
  containers: Readonly<Record<string, readonly ApiRecord[]>>,
): readonly ApiRecord[] {
  const containerNames = Object.keys(containers);
  const concatenated: ApiRecord[] = [];
  for (const name of containerNames) concatenated.push(...containers[name]);
  LOG.debug({
    message:
      `extractAccountRecords: ${String(concatenated.length)} items ` +
      `(${String(containerNames.length)} named containers: ${containerNames.join(',')})`,
  });
  return concatenated;
}

/**
 * Extract account records from API response. Logs the response
 * shape at trace level when zero items are found — exposes per-bank
 * mapper gaps. Tries three extractors in order:
 *
 * <ol>
 *   <li>{@link extractAllContainers} (named WK_ACCT.containers —
 *       cardsList, cards, accounts, bankAccounts; covers card-family
 *       banks where the cards array carries no txn-signature
 *       fields). Concatenates ALL surfaced containers — Phase 7d
 *       change.</li>
 *   <li>{@link findFirstArray} (txn-signature BFS — covers banks
 *       whose account response has txn preview arrays).</li>
 *   <li>{@link rootAccountArray} (root-level array of account-shaped
 *       records — covers Hapoalim's /general/accounts).</li>
 * </ol>
 *
 * @param responseBody - Parsed JSON response body.
 * @returns Account records with all original fields.
 */
function extractAccountRecords(responseBody: ApiRecord): readonly ApiRecord[] {
  const containers = extractAllContainers(responseBody);
  if (Object.keys(containers).length > 0) return flattenContainersForLog(containers);
  const items = findFirstArray(responseBody);
  if (items.length > 0) {
    LOG.debug({ message: `extractAccountRecords: ${String(items.length)} items` });
    return castSearchable(items);
  }
  const rootAccts = rootAccountArray(responseBody);
  if (rootAccts.length > 0) {
    LOG.debug({
      message: `extractAccountRecords: ${String(rootAccts.length)} items (root-array fallback)`,
    });
    return rootAccts;
  }
  LOG.debug({ message: 'extractAccountRecords: 0 items' });
  traceRawShape(responseBody);
  return [];
}

/**
 * Returns true when {@link id} is a real, server-accepted identifier
 * rather than a position index, sentinel, or stringification artifact.
 *
 * <p>The pipeline previously accepted any non-empty string as a valid
 * cardId, which let position indices (`cardIndex: 0` → `"0"`) and the
 * `'default'` credential sentinel slip through into transaction-API
 * URLs — the API silently returned 0 transactions and the pipeline
 * reported `success: true` with empty data. Per the Fail Fast
 * principle, identifiers must be validated at the extraction layer so
 * downstream stages either get a real ID or a loud failure.
 *
 * <p>Accepts: any string ≥ 2 chars that isn't a known sentinel
 * (`default`, `null`, `undefined`). The 2-char minimum rejects all
 * single-digit position values; no real banking identifier is < 2
 * characters in any captured trace across the 11 banks in the
 * registry.
 *
 * @param id - Candidate identifier string.
 * @returns True iff {@link id} is acceptable as a transaction-API
 *   query parameter.
 */
function isUsableIdentifier(id: string): boolean {
  if (id.length < 2) return false;
  if (id === 'default') return false;
  if (id === 'null') return false;
  if (id === 'undefined') return false;
  return true;
}

/**
 * Resolves a single account record to a usable identifier by walking
 * `WK_ACCT.id` (queryId fields first, displayId fields second) in
 * priority order and returning the first value that passes
 * {@link isUsableIdentifier}.
 *
 * <p>Lets banks whose response contains both a position-like field
 * (`cardIndex: 0`) AND a real identifier (`cardNumber: "0814"`)
 * deterministically yield the real one — important for Max-class
 * card-family banks where the SPA omits `cardUniqueId` from the
 * `getRegisterUserData` shape.
 *
 * @param record - One account/card record.
 * @returns First usable identifier, or empty string if none qualify.
 */
/**
 * Resolves a single field name to a usable identifier within a record,
 * or returns the empty-string sentinel when the field is missing or
 * its value fails {@link isUsableIdentifier}. Extracted so
 * {@link extractValidIdentifier} stays inside the one-block max-depth
 * ceiling.
 *
 * @param record - One account/card record.
 * @param field - Single WK identifier field name to probe.
 * @returns Validated identifier or empty string.
 */
function pickIdFromField(record: ApiRecord, field: string): string {
  const value = findFieldValue(record, [field]);
  if (value === false) return '';
  const str = String(value);
  if (!isUsableIdentifier(str)) return '';
  return str;
}

/**
 * Resolves a single record to a usable identifier by walking
 * `WK_ACCT.id` (queryId fields, then displayId fields) and
 * returning the first value that passes {@link isUsableIdentifier}.
 * Drives the queryId-then-displayId fallback that lets card-family
 * banks like Max yield `cardNumber` when `cardUniqueId` is absent.
 *
 * @param record - One account/card record.
 * @returns First usable identifier, or empty-string sentinel.
 */
function extractValidIdentifier(record: ApiRecord): string {
  const candidates = WK_ACCT.id.map((field): string => pickIdFromField(record, field));
  return candidates.find(Boolean) ?? '';
}

/**
 * Extracts validated account identifiers from an API response.
 *
 * @param responseBody - Parsed JSON response body.
 * @returns Array of usable identifier strings (empty when no record
 *   yielded a value passing {@link isUsableIdentifier}).
 */
function extractAccountIds(responseBody: ApiRecord): readonly string[] {
  const records = extractAccountRecords(responseBody);
  return records.map(extractValidIdentifier).filter(Boolean);
}

/**
 * Extract transactions from an API response using stack-based iterative hunt.
 * Filters voided/summary rows. Maps to ITransaction.
 * @param responseBody - Parsed JSON response body.
 * @returns Array of mapped ITransactions.
 */
function extractTransactions(responseBody: ApiRecord): readonly ITransaction[] {
  const items = huntTransactions(responseBody);
  const valid = items.filter((r): boolean => !isVoidedTransaction(r));
  const mapped = valid.map(autoMapTransaction);
  const kept = mapped.filter((t): t is ITransaction => t !== false);
  const count = String(items.length);
  const validCount = String(valid.length);
  const keptCount = String(kept.length);
  const msg = `huntTransactions: ${count} found, ${validCount} valid, ${keptCount} mapped`;
  LOG.debug({ message: msg });
  return kept;
}

// ── Card-aware extraction (anti-mirroring) ──────────────────────────────

/**
 * Step 1: Key-based lookup — find `Index{cardId}` subtree in response.
 * Isracard/Amex pattern: `CardsTransactionsListBean.Index0`, `.Index1`, etc.
 * @param body - API response body.
 * @param cardId - Card index (e.g. '0', '1', '5').
 * @returns Subtree record if found, false otherwise.
 */
function findIndexedSubtree(body: ApiRecord, cardId: string): ApiRecord | false {
  const indexKey = `Index${cardId}`;
  const values = Object.values(body);
  const nested = values.filter((v): boolean => isSearchableObject(v));
  const records = nested.map((v): ApiRecord => v as ApiRecord);
  const match = records.find((rec): boolean => indexKey in rec);
  if (match) return match[indexKey] as ApiRecord;
  return false;
}

/**
 * Step 2: Value-based BFS — filter transaction items by cardIndex field.
 * @param body - API response body.
 * @param cardId - Card index to match.
 * @returns Filtered transaction items, empty if none matched.
 */
function filterByCardIndex(body: ApiRecord, cardId: string): readonly ITransaction[] {
  const allItems = findFirstArray(body);
  const searchable = castSearchable(allItems);
  const matched = searchable.filter((item): boolean => String(item.cardIndex) === cardId);
  if (matched.length === 0) return [];
  const mapped = matched.map(autoMapTransaction);
  return mapped.filter((t): t is ITransaction => t !== false);
}

/**
 * Card-aware extraction — 3-step resolution chain.
 * 1. Key lookup: `Index{cardId}` subtree (Isracard/Amex)
 * 2. Value BFS: filter by `cardIndex` field value
 * 3. Fallback: extract all (single-card response)
 * @param body - API response body.
 * @param cardId - Card index for scoping.
 * @returns Transactions for the specified card only.
 */
function extractTransactionsForCard(body: ApiRecord, cardId: string): readonly ITransaction[] {
  const subtree = findIndexedSubtree(body, cardId);
  if (subtree) {
    LOG.debug({ message: `extractForCard: Index${cardId} → key lookup` });
    return extractTransactions(subtree);
  }
  const byValue = filterByCardIndex(body, cardId);
  if (byValue.length > 0) {
    const count = String(byValue.length);
    LOG.debug({ message: `extractForCard: cardIndex=${cardId} → value BFS (${count} txns)` });
    return byValue;
  }
  LOG.warn({
    message: `STRICT_SCOPE: no data for Card ${cardId} — returning empty (no fallback)`,
  });
  return [];
}

// ── Phase 7e — DASHBOARD.FINAL TXN-endpoint resolver ──────────────────────────

/**
 * Resolve the first-found field-name alias for one TXN-side concern.
 * Walks the WK alias list against the first record's keys (case-
 * sensitive equality) and returns the first match. Pure check, no
 * extraction. Used by {@link resolveTxnEndpoint} to build the per-
 * run {@link ITxnFieldMap}.
 * @param record - First record from the txn array.
 * @param aliases - WK alias list.
 * @returns First matching key, or empty string when no alias hits.
 */
function resolveAlias(record: ApiRecord, aliases: readonly string[]): string {
  const present = aliases.find((alias): boolean => alias in record);
  return present ?? '';
}

/**
 * Same as {@link resolveAlias} but returns `false` instead of empty
 * string when no alias hits. Used for the optional fields
 * (`originalAmount`, `processedDate`, `balance`) that not every bank
 * exposes — consumers test the boolean before walking.
 * @param record - First record from the txn array.
 * @param aliases - WK alias list.
 * @returns First matching key, or `false` when absent.
 */
function resolveOptionalAlias(record: ApiRecord, aliases: readonly string[]): string | false {
  const hit = aliases.find((alias): boolean => alias in record);
  return hit ?? false;
}

/**
 * Build the {@link ITxnFieldMap} for the first txn record in a
 * captured response body. Date and amount are required (their
 * absence trips DASHBOARD.FINAL's F-DASH-2 fail-loud). Other fields
 * are optional.
 * @param sample - First txn record from the captured response.
 * @returns Resolved field map, or `false` when date or amount cannot
 *   be resolved (caller fails the run with F-DASH-2).
 */
/**
 * Pick the amount field alias from a sample record. Banks expose the
 * amount in one of three shapes:
 *
 * <ol>
 *   <li>Single signed amount under {@link WK.amount} (Discount / Max
 *       /Hapoalim and most card-family backends).</li>
 *   <li>Split credit + debit pair under {@link WK.creditAmount} +
 *       {@link WK.debitAmount} (Beinleumi). The runtime
 *       {@link autoMapTransaction} already nets the two sides, so this
 *       helper returns whichever side is present so the field-map
 *       check passes; downstream `parseFreshResponse` consumers must
 *       look at both `creditAmount` and `debitAmount` aliases when
 *       `WK.amount` does not match.</li>
 *   <li>Neither shape — record is not a transaction; return ''.</li>
 * </ol>
 *
 * @param sample - First record from the txn array.
 * @returns Alias string, or '' when no match.
 */
function pickAmountAlias(sample: ApiRecord): string {
  const direct = resolveAlias(sample, WK.amount);
  if (direct !== '') return direct;
  const credit = resolveAlias(sample, WK.creditAmount);
  if (credit !== '') return credit;
  return resolveAlias(sample, WK.debitAmount);
}

/**
 * Build the per-run {@link ITxnFieldMap} from a sample record. Returns
 * `false` when neither a date alias nor any amount alias resolves —
 * DASHBOARD.FINAL escalates to F-DASH-2 in that case so SCRAPE never
 * starts against a body whose schema is unrecognised.
 * @param sample - First record from the txn array.
 * @returns Resolved field map or `false`.
 */
function buildFieldMap(sample: ApiRecord): ITxnFieldMap | false {
  const date = resolveAlias(sample, WK.date);
  const amount = pickAmountAlias(sample);
  if (date === '' || amount === '') return false;
  return {
    date,
    amount,
    description: resolveAlias(sample, WK.description),
    currency: resolveAlias(sample, WK.currency),
    identifier: resolveAlias(sample, WK.identifier),
    originalAmount: resolveOptionalAlias(sample, WK.originalAmount),
    processedDate: resolveOptionalAlias(sample, WK.processedDate),
    balance: resolveOptionalAlias(sample, WK.balance),
  };
}

/**
 * Phase 7e — resolve the TXN endpoint from DASHBOARD's captures.
 *
 * <p>Combines the existing
 * {@link INetworkDiscovery.discoverTransactionsEndpoint} URL pick
 * with a per-run {@link ITxnFieldMap} resolution from the captured
 * response body. The output is the single source of truth SCRAPE
 * consumes — every artifact pre-resolved so SCRAPE imports zero WK.
 *
 * <p>Returns `false` in two cases:
 * <ul>
 *   <li>No capture in the network's pool matches `WK_API.transactions`
 *       (DASHBOARD.FINAL escalates to F-DASH-1).</li>
 *   <li>The picked capture's response body has no record exposing a
 *       date OR amount field that `WK_TXN.date` / `WK_TXN.amount`
 *       recognises (DASHBOARD.FINAL escalates to F-DASH-2).</li>
 * </ul>
 *
 * @param network - Network surface exposing the pool of captures.
 * @returns Resolved {@link ITxnEndpoint}, or `false`.
 */
/** Lookup table for the POST-template branch — replaces an inline ternary. */
const TEMPLATE_POST_LOOKUP: Record<'true' | 'false', (postData: string) => string | false> = {
  /**
   * Captured POST body present.
   * @param postData - Raw POST body.
   * @returns Same string back.
   */
  true: (postData): string | false => postData,
  /**
   * No POST body (GET endpoint or empty body).
   * @returns Sentinel false.
   */
  false: (): string | false => false,
};

/**
 * Resolve the POST template for {@link ITxnEndpoint.templatePostData}
 * — extracted so {@link resolveTxnEndpoint} stays inside the
 * cyclomatic-complexity ceiling.
 * @param method - HTTP method of the captured endpoint.
 * @param postData - Raw POST body (empty string when not a POST).
 * @returns The body when method=POST and body non-empty, false otherwise.
 */
function resolveTemplatePostData(method: 'GET' | 'POST', postData: string): string | false {
  const hasPostBody = method === 'POST' && postData !== '';
  const key = String(hasPostBody) as 'true' | 'false';
  return TEMPLATE_POST_LOOKUP[key](postData);
}

/**
 * Phase 7e — resolve the TXN endpoint from DASHBOARD's captures.
 * Combines the existing
 * {@link INetworkDiscovery.discoverTransactionsEndpoint} URL pick
 * with a per-run {@link ITxnFieldMap} resolution from the captured
 * response body. Returns `false` when the network has no captured
 * TXN URL OR the picked body has no record exposing a date AND
 * amount field — DASHBOARD.FINAL escalates each case to a distinct
 * fail-loud error.
 * @param network - Network surface exposing the pool of captures.
 * @returns Resolved endpoint or `false`.
 */
/**
 * Resolve the pending-transactions API URL from captured traffic, or
 * fall back to constructing it under the discovered API origin using
 * the canonical `Transactions/api/approvals/getClearanceRequests`
 * path. Returns `false` when neither source resolves a URL — the
 * bank simply does not expose pending in this run.
 *
 * <p>Phase 7e: this discovery moves out of {@link fetchAndMergePending}
 * and into DASHBOARD.FINAL's {@link resolveTxnEndpoint} — SCRAPE
 * consumes the pre-resolved URL via `ctx.txnEndpoint.pendingUrl` and
 * imports zero `WK_API`.
 *
 * @param network - Network surface exposing the captured pool.
 * @returns Pending URL string or `false`.
 */
function resolvePendingUrl(network: INetworkDiscovery): string | false {
  const ep = network.discoverByPatterns(WK_API.pending);
  if (ep) return ep.url;
  const origin = network.discoverApiOrigin();
  if (!origin) return false;
  return `${origin}/Transactions/api/approvals/getClearanceRequests`;
}

/**
 * Returns true when a captured POST body carries any
 * {@link WK_ACCT.queryId} alias — i.e. the request is scoped per-card.
 * Used to distinguish a billing endpoint (per-card POST) from other
 * captures matching `WK_API.transactions`.
 * @param postData - Captured POST body string.
 * @returns True when at least one alias appears.
 */
function billingBodyCarriesCardId(postData: string): boolean {
  if (!postData) return false;
  return WK_ACCT.queryId.some((alias): boolean => postData.includes(alias));
}

/**
 * Build the canonical billing URL under a discovered API origin using
 * `WK_BILLING` path fragments. No hostname is hardcoded — the origin
 * comes from a URL the bank's own SPA already touched.
 * @param anyCapturedUrl - URL already captured on the target host.
 * @returns Built billing URL string.
 */
function buildBillingUrlFromOrigin(anyCapturedUrl: string): string {
  const origin = new URL(anyCapturedUrl).origin;
  const { apiPrefix, pathFragment, actionName } = WK_BILLING;
  return `${origin}${apiPrefix}/${pathFragment}/${actionName}`;
}

/**
 * Resolve the billing-fallback URL from captured traffic. Priority:
 * <ol>
 *   <li>A captured URL already under {@link WK_BILLING.pathFragment}
 *       — use its origin directly.</li>
 *   <li>A captured `WK_API.transactions` URL whose POST body carries a
 *       `WK_ACCT.queryId` alias — build a canonical billing URL
 *       under that capture's origin.</li>
 *   <li>No match — return `false` (bank doesn't expose the family).</li>
 * </ol>
 *
 * <p>Phase 7e: this discovery moves out of
 * {@link tryBillingFallback} and into DASHBOARD.FINAL's
 * {@link resolveTxnEndpoint} — SCRAPE consumes the pre-resolved URL
 * via `ctx.txnEndpoint.billingUrl` and imports zero
 * `WK_API`/`WK_BILLING`.
 *
 * @param network - Network surface exposing the captured pool.
 * @returns Built billing URL or `false`.
 */
function resolveBillingUrl(network: INetworkDiscovery): string | false {
  const captured = network.getAllEndpoints();
  const direct = captured.find((ep): boolean => ep.url.includes(WK_BILLING.pathFragment));
  if (direct) return buildBillingUrlFromOrigin(direct.url);
  const txnPatterns = WK_API.transactions;
  const shaped = captured.find((ep): boolean => {
    const isUrlMatch = txnPatterns.some((p): boolean => p.test(ep.url));
    if (!isUrlMatch) return false;
    return billingBodyCarriesCardId(ep.postData);
  });
  if (shaped) return buildBillingUrlFromOrigin(shaped.url);
  return false;
}

/** Empty fieldMap returned when the picked capture has zero transaction
 *  records (replayablePost tier — bank's session window has no recent
 *  activity). The URL+method are still authoritative for SCRAPE replay;
 *  per-account requests may yield non-empty bodies and `extractTransactions`
 *  auto-discovers fields at parse time. */
const EMPTY_FIELD_MAP: ITxnFieldMap = {
  date: '',
  amount: '',
  description: '',
  currency: '',
  identifier: '',
  originalAmount: false,
  processedDate: false,
  balance: false,
};

/**
 * Resolve a fieldMap from the first transaction record, or fall back to
 * the empty fieldMap when the body has zero records. SCRAPE re-fetches
 * per-account, so the empty case is valid for `replayablePost` URLs.
 * @param records - Records harvested by `huntTransactions`.
 * @returns Resolved fieldMap (never `false`).
 */
function resolveFieldMapOrEmpty(records: readonly ApiRecord[]): ITxnFieldMap {
  if (records.length === 0) return EMPTY_FIELD_MAP;
  const sampleFieldMap = buildFieldMap(records[0]);
  if (sampleFieldMap === false) return EMPTY_FIELD_MAP;
  return sampleFieldMap;
}

/**
 * Phase 7f — resolve the TXN endpoint from DASHBOARD's captures.
 * Returns the wider {@link ITxnEndpointInternal} so DASHBOARD.FINAL
 * can emit the `dashboard.txnEndpoint.committed` telemetry with the
 * picker's diagnostics; DASHBOARD then unwraps `.endpoint` and
 * commits ONLY the slim {@link ITxnEndpoint} to `ctx.txnEndpoint`.
 * SCRAPE never sees `captureIndex`, `responseBodySample`,
 * `normalizedRecords`, `pickerTier`, or `capturedPreClick`.
 *
 * <p>Returns `false` ONLY when the picker found no URL match or the
 * body is malformed JSON. An empty body for a valid `replayablePost`
 * URL is committed with an empty fieldMap — SCRAPE re-fetches per
 * account and the per-account parse falls back to legacy
 * auto-discovery for that one execution.
 *
 * @param network - Network surface exposing the pool of captures.
 * @returns Resolved internal payload or `false`.
 */
function resolveTxnEndpoint(network: INetworkDiscovery): ITxnEndpointInternal | false {
  const ep = network.discoverTransactionsEndpoint();
  if (ep === false) return false;
  const body = ep.responseBody;
  // Phase H' (2026-05-14): a null body is a valid 2xx-no-content
  // response (e.g. 204 from Hapoalim's current-account transactions
  // when the SPA-default 30-day window holds zero txns). Treat as
  // an empty object so URL+method are still committed; SCRAPE
  // re-queries with the user's wider startDate window and the
  // auto-mapper resolves field aliases via WK on the populated
  // response. Body MUST be `null | object`; primitives are rejected.
  if (body !== null && typeof body !== 'object') return false;
  if (ep.method !== 'GET' && ep.method !== 'POST') return false;
  const responseBody = (body ?? {}) as ApiRecord;
  const records = huntTransactions(responseBody);
  const fieldMap = resolveFieldMapOrEmpty(records);
  const method: 'GET' | 'POST' = ep.method;
  const endpoint: ITxnEndpoint = {
    url: ep.url,
    method,
    templatePostData: resolveTemplatePostData(method, ep.postData),
    fieldMap,
    pendingUrl: resolvePendingUrl(network),
    billingUrl: resolveBillingUrl(network),
  };
  return {
    endpoint,
    captureIndex: ep.captureIndex ?? 0,
    responseBodySample: responseBody,
    normalizedRecords: extractTransactions(responseBody),
    pickerTier: ep.pickerTier ?? 'shapePassing',
    capturedPreClick: ep.capturedPreClick ?? false,
  };
}

// Phase 7e checkpoint: `parseFreshResponse` and `buildPerAccountBody`
// stubs were removed pending the SCRAPE migration that consumes them
// (Phase 7e.5+). When SCRAPE.ACTION starts walking fresh per-account
// responses via `ctx.txnEndpoint.fieldMap`, the helpers re-land here
// alongside the per-WK ownership-test changes.

export type {
  ITxnEndpoint as TxnEndpoint,
  ITxnFieldMap as TxnFieldMap,
} from '../../Types/PipelineContext.js';
export {
  autoMapTransaction,
  extractAccountIds,
  extractAccountRecords,
  extractAllContainers,
  extractTransactions,
  extractTransactionsForCard,
  findAllFieldValues,
  findFieldValue,
  findFirstArray,
  isUsableIdentifier,
  matchField,
  parseAutoDate,
  resolveTxnEndpoint,
};
