import type { ITransaction } from '../../../../../Transactions.js';
import { TransactionStatuses, TransactionTypes } from '../../../../../Transactions.js';
import { PIPELINE_WELL_KNOWN_TXN_FIELDS as WK } from '../../../Registry/WK/ScrapeWK.js';
import { type ApiRecord } from '../AutoMapperFacade/AutoMapperTypes.js';

/**
 * Provider fields the shared auto-mapper cannot reach by aliasing alone.
 *
 * Every institution routes through `autoMapTransaction`, which populates an
 * {@link ITransaction} field only when the payload carries a key listed for it
 * in the Well-Known dictionary (`Registry/WK/ScrapeFieldMappings.ts`). Five
 * optional fields on that interface had no entry there at all, so they were
 * never populated — even though the provider payload carries them, and even
 * though the per-institution scrapers in the original `israeli-bank-scrapers`
 * do populate them:
 *
 * | Field             | Consequence of dropping it                        |
 * |-------------------|---------------------------------------------------|
 * | `memo`            | for some banks the only counterparty signal at all |
 * | `category`        | the issuer's own classification hint               |
 * | `chargedCurrency` | absent is indistinguishable from "no conversion"   |
 * | `status`          | a pending row is stored as settled                 |
 * | `installments`    | the ordinals telling one payment of a plan apart   |
 *
 * `category` and `chargedCurrency` are plain key-aliasing, so they are WK
 * entries and need no code here — covering another institution is a one-line
 * dictionary addition. This module owns only what aliasing cannot express:
 *
 * - `memo`, where two providers need a shape rather than a key: a nested
 *   beneficiary block flattened to one line, and a comment list joined. The
 *   plain-key aliases still come from `WK.memo`, so adding a bank stays a
 *   dictionary edit.
 * - `installments`, derived from numeric ordinals or parsed out of free text.
 * - `status`, inferred from what the row omits rather than what it states.
 * - `type`, which follows from whether ordinals resolved.
 *
 * Misses are reported as `false` rather than `undefined`, per the pipeline's
 * own miss-sentinel convention.
 */

/**
 * Instalment ordinals, bound to the shape {@link ITransaction} declares.
 *
 * Derived from the consuming field rather than restated, so a change to the
 * published interface cannot leave this module compiling against a stale copy.
 */
type IInstallments = NonNullable<ITransaction['installments']>;

/** Hebrew keyword marking an instalment memo on the Isracard/Amex payloads. */
const INSTALLMENTS_KEYWORD = 'תשלום';

/**
 * Read a non-blank string field, trimmed.
 *
 * Trimming before the blank check is load-bearing rather than cosmetic: the
 * Isracard and Amex payloads send `moreInfo` as a run of spaces on rows that
 * carry no note (100 of 173 and 99 of 172 rows in the captured runs), which an
 * exact `=== ''` test accepts and turns into a whitespace-only memo.
 *
 * @param value - Candidate raw value.
 * @returns The trimmed string, or `false` when absent or blank.
 */
function asText(value: unknown): string | false {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return trimmed === '' ? false : trimmed;
}

/**
 * Reject an ordinal pair that cannot describe a position within a real plan.
 *
 * Shared by both resolution paths so neither can publish an `installments`
 * object the interface cannot honestly carry — the same class of defect as
 * emitting an instalment *type* with no ordinals behind it. A usable pair is
 * whole, positive, and does not place the current payment past the end of the
 * plan. No captured row violates any of the three: of the 1305 rows carrying a
 * payments total, none is fractional and none has `number > total`. This
 * guards the published contract rather than an observed payload.
 *
 * @param number - Candidate current-payment ordinal.
 * @param total - Candidate plan length.
 * @returns `true` when the pair is a usable position within a plan.
 */
function areSaneOrdinals(number: number, total: number): boolean {
  if (!Number.isInteger(number) || !Number.isInteger(total)) return false;
  if (number <= 0 || total <= 0) return false;
  return number <= total;
}

/**
 * Parse the leading two integers out of a free-text instalment note.
 *
 * @param text - Provider comment/note text.
 * @returns Ordinals, or `false` when the text carries fewer than two usable
 *   ones.
 */
function twoOrdinals(text: string): IInstallments | false {
  const matches = text.match(/\d+/g);
  if (matches === null || matches.length < 2) return false;
  const number = Number.parseInt(matches[0], 10);
  const total = Number.parseInt(matches[1], 10);
  return areSaneOrdinals(number, total) ? { number, total } : false;
}

/**
 * Render one beneficiary part, with its trailing punctuation.
 *
 * @param value - Candidate raw value from the beneficiary block.
 * @param suffix - Punctuation the per-institution scrapers append.
 * @returns The rendered part, or an empty string when absent.
 */
function beneficiaryPart(value: unknown, suffix: string): string {
  const text = asText(value);
  return text === false ? '' : `${text}${suffix}`;
}

/**
 * Collect the present parts of a beneficiary block, in scraper order.
 *
 * @param details - The beneficiary block.
 * @returns Rendered parts, absent ones dropped.
 */
function beneficiaryParts(details: Record<string, unknown>): readonly string[] {
  const parts = [
    beneficiaryPart(details.partyHeadline, ''),
    beneficiaryPart(details.partyName, '.'),
    beneficiaryPart(details.messageHeadline, ''),
    beneficiaryPart(details.messageDetail, '.'),
  ];
  return parts.filter((p): boolean => p !== '');
}

/**
 * Flatten the nested beneficiary block some bank payloads carry into the
 * single-line memo the per-institution scrapers produce.
 *
 * @param raw - Provider record.
 * @returns The flattened memo, or `false` when the block is absent.
 */
function beneficiaryMemo(raw: ApiRecord): string | false {
  const block = raw.beneficiaryDetailsData;
  if (typeof block !== 'object' || block === null) return false;
  const details = block as Record<string, unknown>;
  const parts = beneficiaryParts(details);
  if (parts.length === 0) return false;
  return parts.join(' ');
}

/**
 * Read the memo out of the comment field, which arrives as a list on the
 * providers that send more than one comment per row.
 *
 * @param raw - Provider record.
 * @returns Memo text, or `false`.
 */
function commentMemo(raw: ApiRecord): string | false {
  const comment = raw.transTypeCommentDetails;
  if (!Array.isArray(comment)) return asText(comment);
  const joined = comment.join(', ');
  return asText(joined);
}

/**
 * Read the memo from the first plain-key alias this record carries.
 *
 * The alias list lives in WK so that covering another institution stays a
 * dictionary edit; order there is precedence.
 *
 * @param raw - Provider record.
 * @returns Memo text, or `false` when no alias matches.
 */
function aliasMemo(raw: ApiRecord): string | false {
  const hits = WK.memo.map((alias): string | false => asText(raw[alias]));
  return hits.find((hit): boolean => hit !== false) ?? false;
}

/**
 * Resolve the memo from whichever field this provider supplies it in.
 *
 * @param raw - Provider record.
 * @returns Memo text, or `false`.
 */
function resolveMemo(raw: ApiRecord): string | false {
  const beneficiary = beneficiaryMemo(raw);
  if (beneficiary !== false) return beneficiary;
  const alias = aliasMemo(raw);
  if (alias !== false) return alias;
  return commentMemo(raw);
}

/**
 * Read instalment ordinals from the explicit numeric fields.
 *
 * @param raw - Provider record.
 * @returns Ordinals, or `false` when the fields are absent or unusable.
 */
function explicitInstallments(raw: ApiRecord): IInstallments | false {
  const explicitTotal = raw.numOfPayments ?? raw.numberOfPayments;
  if (explicitTotal === undefined || explicitTotal === null) return false;
  const total = Number(explicitTotal);
  // A pending row carries only the total, and the per-institution scraper
  // treats it as payment 1.
  const number = raw.numOfPayments === undefined ? 1 : Number(raw.curPaymentNum);
  return areSaneOrdinals(number, total) ? { number, total } : false;
}

/**
 * Read instalment ordinals from a free-text note.
 *
 * Guarded by the keyword so an unrelated two-number memo cannot be read as an
 * instalment plan.
 *
 * @param raw - Provider record.
 * @returns Ordinals, or `false` when the note is absent or unkeyed.
 */
function noteInstallments(raw: ApiRecord): IInstallments | false {
  const note = asText(raw.moreInfo);
  if (note === false) return false;
  if (!note.includes(INSTALLMENTS_KEYWORD)) return false;
  return twoOrdinals(note);
}

/**
 * Resolve instalment ordinals from whichever shape this provider uses.
 *
 * @param raw - Provider record.
 * @returns Ordinals, or `false` when this is not an instalment row.
 */
function resolveInstallments(raw: ApiRecord): IInstallments | false {
  const explicit = explicitInstallments(raw);
  if (explicit !== false) return explicit;
  return noteInstallments(raw);
}

/**
 * Resolve the settlement status, defaulting to the mapper's own `Completed`.
 *
 * @param raw - Provider record.
 * @returns `Pending` where the payload says so, otherwise `false`.
 */
function resolvePending(raw: ApiRecord): TransactionStatuses | false {
  if (raw.serialNumber === 0) return TransactionStatuses.Pending;
  // A purchase row that has not yet been assigned a debit date.
  const isUnbilledPurchase = 'trnPurchaseDate' in raw && raw.debCrdDate === undefined;
  if (isUnbilledPurchase) return TransactionStatuses.Pending;
  return false;
}

/**
 * The fields changing how a row is interpreted, rather than what it says.
 *
 * @param raw - Provider record.
 * @returns Partial carrying only the state fields actually found.
 */
function rowState(raw: ApiRecord): Partial<ITransaction> {
  const restored: Partial<ITransaction> = {};
  const status = resolvePending(raw);
  if (status !== false) restored.status = status;
  const installments = resolveInstallments(raw);
  if (installments !== false) restored.installments = installments;
  return restored;
}

/**
 * Decide the transaction type from the ordinals themselves.
 *
 * Deliberately not keyed on any provider's transaction-type code. VisaCal
 * sends one, but its codes classify the kind of charge rather than the payment
 * structure: across 1305 captured rows, code 6 is a refund (זיכוי) and code 7
 * a cash withdrawal (משיכת מזומן) — neither is a plan, and neither carries
 * ordinals. Reading the code as a plan marker labelled all nine such rows
 * `Installments` with no `installments` object to back the claim. The only
 * real plan in that sample (code 8) resolves ordinals on its own, so this
 * check alone classifies every captured row correctly.
 *
 * @param installments - Ordinals already resolved for this row, if any.
 * @param fallback - The type the mapper resolved on its own.
 * @returns The instalment type where ordinals resolved, else the fallback.
 */
function resolveType(
  installments: ITransaction['installments'],
  fallback: TransactionTypes,
): TransactionTypes {
  return installments === undefined ? fallback : TransactionTypes.Installments;
}

/**
 * Fields the auto-mapper can recover from the provider record.
 *
 * Spread over the mapped transaction, so every key it omits leaves the
 * mapper's own value untouched.
 *
 * @param raw - Provider record backing this transaction.
 * @param fallbackType - The type the mapper resolved on its own.
 * @returns Partial transaction carrying only the fields actually found.
 */
export default function restoreProviderFields(
  raw: ApiRecord,
  fallbackType: TransactionTypes,
): Partial<ITransaction> {
  const state = rowState(raw);
  const memo = resolveMemo(raw);
  const type = resolveType(state.installments, fallbackType);
  return memo === false ? { ...state, type } : { ...state, memo, type };
}
