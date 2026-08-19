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
import { findFieldValue } from '../BfsFieldSearch/BfsFieldSearch.js';

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
  // Guarded so zero cannot become -0, which serialises as "-0" and is unequal
  // to a stored 0 under Object.is.
  if (amount === 0) return 0;
  return -amount;
}

/**
 * Apply WK.direction sign convention. Debit indicators flip a positive
 * amount to negative; missing / non-debit directions leave the amount
 * untouched.
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
