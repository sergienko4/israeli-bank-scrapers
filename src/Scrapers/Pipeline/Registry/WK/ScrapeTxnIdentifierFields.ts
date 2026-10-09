/**
 * WellKnown transaction-identifier aliases — split out of
 * {@link ./ScrapeFieldMappings.js} to keep that module under the 150-line
 * max-lines ceiling, following {@link ./ScrapeIdFields.js} and
 * {@link ./ScrapeProviderFields.js}.
 *
 * <p>Order is precedence: the first alias a record carries wins. Spread back
 * into `PIPELINE_WELL_KNOWN_TXN_FIELDS.identifier`, so callers still see one
 * dictionary.
 */
const TXN_IDENTIFIER_FIELDS = [
  'bancsIdentifier',
  'mizrahiIdentifier', // Mizrahi — legacy composite id, synthesized by MizrahiShapeIdentifier
  'OperationNumber',
  'trnIntId',
  'identifier',
  'id',
  'referenceNumber',
  // Beinleumi (FIBI group) — account-scoped running sequence number on
  // `transactions/list` rows. Ranked above `reference` because measurement
  // on captured responses shows `reference` is a counterparty/instruction
  // reference, not a per-row key: one response carried 42 rows sharing only
  // 9 distinct values, the worst repeating 15 times (a recurring salary
  // transfer keeps one reference across months). `counter` was unique in
  // every capture that carries it (41/41, 44/44) and named the same
  // transaction across two runs of differing windows (41/41 matched), so it
  // must win when both are present — the same precedence rule FITID has
  // over ReferenceNumberLong below.
  //
  // `reference` stays as the fallback: the provider only began emitting
  // `counter` between the 2026-08-08 and 2026-08-10 captures, so older
  // responses still resolve through it.
  //
  // Safe to rank globally despite the generic name: `"counter"` appears as
  // a JSON key in 2 of 10,471 captured response files, both Beinleumi, and
  // in none of the 9,357 files captured from the other eleven banks.
  'counter',
  'reference',
  'txnId',
  'confirmationNumber',
  'movementId',
  'transactionId',
  // Phase F additions (2026-05-13) — bank-specific per-txn unique IDs
  // surfaced by the cross-bank verification run. Every Israeli bank
  // emits a stable `Asmachta`-style ID; the auto-mapper just needed
  // the alias list to recognise them.
  'seqVoucherNumber', // Isracard / Amex — vouchers + approvals
  'voucherNumber', // Isracard / Amex — backup numeric ID
  'seqConfirmationNumber', // Isracard approvedTransactions — long-form ID
  'uid', // Max — base-X txn UID
  'arn', // Max — acquirer reference number
  'authorizationNumber', // Max — bank authorization id
  'Urn', // Discount — operation-record URN
  'runtimeReferenceId', // Max — runtimeReference.id top-level alias
  // Leumi — OFX "Financial Institution Transaction ID". Measured against
  // captured UC_SO_27 responses: FITID is unique per row in every
  // response, whereas the coarser `ReferenceNumberLong` below repeats
  // within any response carrying five or more rows. FITID must therefore
  // win when both are present.
  'FITID',
  'ReferenceNumberLong', // Leumi — UC_SO_27 reference; NOT per-txn unique
  'MC02AsmahtaMekoritEZ', // Mizrahi reference (Mizrahi-only key, appended last)
] as const;

export default TXN_IDENTIFIER_FIELDS;
