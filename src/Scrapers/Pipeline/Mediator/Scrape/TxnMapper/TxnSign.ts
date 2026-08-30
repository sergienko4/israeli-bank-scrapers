/**
 * Amount sign resolution for a single raw API record.
 *
 * Owns every rule that decides which side of zero a mapped amount lands on:
 * the card issuer's inverted convention, the WK direction override, and the
 * reconciliation of records whose two amount fields disagree. Extracted from
 * TxnMapper so the mapper is left with pure field coercion.
 */

import { PIPELINE_WELL_KNOWN_TXN_FIELDS as WK } from '../../../Registry/WK/ScrapeWK.js';
import { type ApiRecord } from '../AutoMapperFacade/AutoMapperTypes.js';
import { findFieldValue, matchFieldInRecord } from '../BfsFieldSearch/BfsFieldSearch.js';

/** Per-record sign context shared by both amounts of one transaction. */
interface ICardSignContext {
  readonly raw: ApiRecord;
  readonly isCard: boolean;
  readonly isCredit: boolean;
}

/** The two raw amounts of one record, plus the institution's convention. */
export interface ICardSignArgs {
  readonly raw: ApiRecord;
  readonly amount: number;
  readonly original: number;
  readonly isCard: boolean;
}

/** Both amounts of one record after sign resolution. */
export interface ISignedAmounts {
  amtNum: number;
  origNum: number;
}

/**
 * Flip a card issuer's sign convention to the caller-facing one.
 *
 * Card issuers report a charge as a positive number — "you owe 122.17" — while
 * consumers expect spend to be negative. So the sign is INVERTED, not forced.
 *
 * `-Math.abs(amount)` was wrong: a refund arrives from the issuer as a negative
 * number, and forcing the sign turned it straight back into a charge. A charge
 * and its later refund therefore both mapped to charges, so the refunded money
 * never came back. Inverting handles both directions, and matches what the
 * per-institution scrapers in the original `israeli-bank-scrapers` do
 * (`chargedAmount: -actualPaymentAmount`).
 *
 * @param amount - Raw amount from API.
 * @param isCardTxn - Whether this is a card company transaction.
 * @returns Sign-inverted amount for cards, original for banks.
 */
function maybeNegateAmount(amount: number, isCardTxn: boolean): number {
  if (!isCardTxn) return amount;
  // Guarded so zero cannot become -0: it passes `=== 0` but is distinguishable
  // through Object.is and 1 / x, so it is unequal to a stored 0.
  if (amount === 0) return 0;
  return -amount;
}

/**
 * One bank's numeric direction-code convention.
 *
 * `field` names the property carrying the code; `inbound` and `outbound` are
 * the exact numeric codes that field uses for money in and money out. Both
 * halves are declared together so a registered field can never be missing its
 * codes, and so two banks sharing a field name but not its values stay
 * separately describable.
 */
interface IDirectionCodeConvention {
  readonly field: string;
  readonly inbound: number;
  readonly outbound: number;
}

/**
 * Direction-code conventions, one per bank field that carries one.
 *
 * Some banks send the amount as an unsigned MAGNITUDE and put the direction in
 * a numeric activity code instead of a debit/credit word. Hapoalim is the
 * reference case: `eventActivityTypeCode` is 1 for money in and 2 for money
 * out, which is the rule the upstream per-institution scraper applies
 * (`const isOutbound = txn.eventActivityTypeCode === 2`).
 *
 * This cannot live in the WK registry: that registry is contractually a map of
 * field NAMES (`satisfies Record<string, string[]>`) with nowhere to put the
 * code half of the rule.
 */
const DIRECTION_CODE_CONVENTIONS: readonly IDirectionCodeConvention[] = [
  { field: 'eventActivityTypeCode', inbound: 1, outbound: 2 },
];

/** Which way money moved, or `unknown` when no code field decided it. */
type CodedDirection = 'inbound' | 'outbound' | 'unknown';

/**
 * Read one convention against a record.
 *
 * The field is matched on the record ROOT only, never through the nested
 * search the worded reader uses: a code buried in a sub-record — a
 * counterparty, a beneficiary block — describes that sub-record, not this
 * transaction, and must not decide the parent's sign. Codes are compared with
 * strict numeric equality, matching upstream's `=== 2`, so a quoted or
 * otherwise reformatted value is left undecided rather than guessed at.
 *
 * @param raw - Raw transaction record.
 * @param convention - The bank convention to read.
 * @returns The direction this convention proves, or `unknown`.
 */
function directionByConvention(
  raw: ApiRecord,
  convention: IDirectionCodeConvention,
): CodedDirection {
  const code = matchFieldInRecord(raw, [convention.field]);
  if (code === convention.outbound) return 'outbound';
  if (code === convention.inbound) return 'inbound';
  return 'unknown';
}

/**
 * The direction a record states numerically, if any.
 * @param raw - Raw transaction record.
 * @returns The first direction a known code field proves, else `unknown`.
 */
function codedDirectionOf(raw: ApiRecord): CodedDirection {
  /**
   * Read one convention against this record.
   * @param convention - Convention to read.
   * @returns The direction it proves, or `unknown`.
   */
  const read = (convention: IDirectionCodeConvention): CodedDirection =>
    directionByConvention(raw, convention);
  const results = DIRECTION_CODE_CONVENTIONS.map(read);
  const decided = results.find((d): boolean => d !== 'unknown');
  return decided ?? 'unknown';
}

/**
 * Force a magnitude negative.
 *
 * Guarded so zero cannot become -0. Negative zero passes `=== 0` but is
 * distinguishable through `Object.is` and `1 / x`, so letting it escape makes a
 * zero-amount row unequal to a stored 0 — the same hazard
 * {@link maybeNegateAmount} guards.
 *
 * @param amount - Amount to drive negative.
 * @returns The negative magnitude, or 0 when there is no magnitude.
 */
function negativeMagnitude(amount: number): number {
  if (amount === 0) return 0;
  return -Math.abs(amount);
}

/**
 * Apply the WK direction sign convention.
 *
 * A numeric direction code is AUTHORITATIVE and read first. It is an explicit
 * statement by the bank, so it settles the sign outright rather than merely
 * adding a negation: a coded inbound row keeps its magnitude positive even if a
 * worded field or a card issuer's inverted convention would otherwise flip it.
 * The worded reader below only ever matched strings, so a coded record used to
 * fall through it and keep the unsigned magnitude the API sent.
 *
 * With no code present, behaviour is unchanged: debit indicators flip a
 * positive amount to negative, and missing / non-debit directions leave the
 * amount untouched.
 *
 * @param raw - Raw transaction record.
 * @param amount - Amount already resolved via resolveAmount + maybeNegateAmount.
 * @returns Sign-corrected amount.
 */
function applyDirectionWk(raw: ApiRecord, amount: number): number {
  const coded = codedDirectionOf(raw);
  if (coded === 'outbound') return negativeMagnitude(amount);
  if (coded === 'inbound') return Math.abs(amount);
  const direction = findFieldValue(raw, WK.direction);
  if (typeof direction !== 'string') return amount;
  if (!/^debit$/i.test(direction)) return amount;
  return negativeMagnitude(amount);
}

/**
 * Detect a credit (refund) that only one of a record's two amount fields
 * signs.
 *
 * A refund is a refund in both currencies, so the charged and original amounts
 * of one record always share a direction — Isracard proves it even on a
 * foreign-currency refund, where the two differ in magnitude and currency but
 * agree in sign. Some issuers sign only one of them: VisaCal sends `trnAmt` as
 * an unsigned magnitude while `amtBeforeConvAndIndex` carries the minus, so its
 * refunds arrived looking like charges in the field consumers actually read.
 *
 * A negative value is unambiguous evidence of a credit; a positive one cannot
 * distinguish "charge" from "unsigned magnitude". So when the two disagree, the
 * negative side wins.
 *
 * @param amount - Raw charged amount, as the API sent it.
 * @param original - Raw original-currency amount, as the API sent it.
 * @returns True when exactly one of the two carries a minus sign.
 */
function isPartiallySignedCredit(amount: number, original: number): boolean {
  const isAmountNegative = amount < 0;
  const isOriginalNegative = original < 0;
  return isAmountNegative !== isOriginalNegative;
}

/**
 * Run the full sign pipeline over one raw amount: credit normalisation, then
 * the card inversion, then the direction-WK correction.
 *
 * Normalising a credit to negative BEFORE the inversion keeps the rule
 * idempotent — an issuer that already signs its refunds is unchanged by the
 * normalisation, so a single path serves both issuer styles.
 *
 * @param amount - Raw amount, as the API sent it.
 * @param ctx - Per-record sign context.
 * @returns Sign-corrected amount.
 */
function signCardAmount(amount: number, ctx: ICardSignContext): number {
  const normalised = ctx.isCredit ? -Math.abs(amount) : amount;
  const negated = maybeNegateAmount(normalised, ctx.isCard);
  return applyDirectionWk(ctx.raw, negated);
}

/**
 * Resolve the caller-facing sign of both amounts of one raw record.
 *
 * Reconciles the two fields first (see {@link isPartiallySignedCredit}), so a
 * credit is recognised even when the issuer signed only one of them, then runs
 * the same pipeline over each — leaving the pair on the same side of zero.
 *
 * @param args - Both raw amounts plus the institution's convention.
 * @returns Signed amounts ready to assign to the mapped txn.
 */
export function signCardAmounts(args: ICardSignArgs): ISignedAmounts {
  const isCredit = args.isCard && isPartiallySignedCredit(args.amount, args.original);
  const ctx: ICardSignContext = { raw: args.raw, isCard: args.isCard, isCredit };
  const amtNum = signCardAmount(args.amount, ctx);
  return { amtNum, origNum: signCardAmount(args.original, ctx) };
}
