/**
 * Provider-annotation field aliases — the descriptive fields a row carries
 * alongside its date/amount/description core.
 *
 * Split out of {@link ./ScrapeFieldMappings.js} to keep that module under the
 * 150-line `max-lines` ceiling, following the precedent already set there by
 * {@link ./ScrapeIdFields.js} and {@link ./ScrapeMonthlyFields.js}.
 *
 * Each group is spread back into `PIPELINE_WELL_KNOWN_TXN_FIELDS`, so callers
 * see one dictionary and covering another institution stays a one-line edit
 * here.
 *
 * Evidence cited per alias is a captured forensic run under
 * `C:\tmp\runs\pipeline\<bank>\`; counts are rows carrying a non-empty value.
 *
 * Institution sweep — all 12 supported providers were checked against captured
 * rows (or, where no captured dump is available, against the
 * provider's closed query contract). The eight not aliased here are covered or
 * genuinely have nothing to add:
 *
 * - Max: sends `categoryId` (numeric) and `planName` ("רגילה"), a charge kind
 *   rather than a sector — the same reason VisaCal's `trnType` is excluded.
 * - Hapoalim: its beneficiary block is a composite, handled in RestoredFields.
 * - Beinleumi: its only free-text fields are `Name`/`CustomerName`, which hold
 *   the account holder's own name — PII, and of no value on a row.
 * - Yahav: the corpus carries no transaction rows, only an error-code table.
 * - PayBox: its shape emits `memo` directly, before the auto-mapper runs.
 * - OneZero: `categories` are numeric ids; its detail unions carry only
 *   i18n description keys, already consumed as `description`.
 * - Pepper: closed 10-field contract; `title`/`subTitle` are candidates but no
 *   captured value exists to justify a precedence order, so neither is added.
 * - Leumi/Discount/Isracard/Amex/VisaCal are aliased above.
 */

/**
 * Free-text note the provider attaches to a row. Populates
 * {@link ITransaction.memo}, which had no WK entry at all, so the shared
 * auto-mapper dropped it for every institution.
 *
 * Order is precedence: the first alias a record carries wins. Each entry is
 * specific enough that it cannot fire for a provider that does not send it,
 * which is what lets one list serve every bank.
 *
 * Two providers need a shape rather than a key — a nested beneficiary block
 * and a comment array — and are handled in
 * {@link "../../Mediator/Scrape/TxnMapper/RestoredFields.js"} instead.
 */
const MEMO_FIELDS: string[] = [
  'moreInfo', // Isracard / Amex — 73 of 279 rows
  'AdditionalData', // Leumi UC_SO_27 — 17 of 65 rows ("העברה מאת: …")
  'OperationDescription2', // Discount — 598 of 626 rows ("חיוב")
  'OperationDescription3', // Discount — 189 of 626 rows
];

/**
 * The issuer's own classification of the row, distinct from the merchant name
 * that `description` carries. Populates {@link ITransaction.category},
 * previously unreachable.
 *
 * Only human-readable classifications are listed. Discount also sends a
 * numeric `CategoryCode` on 584 rows, deliberately excluded: "11" is not a
 * category a caller can display.
 */
const CATEGORY_FIELDS: string[] = [
  'branchCodeDesc', // VisaCal merchant sector — 1233 of 1305 rows
  'transactionDescription', // Isracard / Amex — 285 of 285 rows
  'CategoryDescription', // Discount — 231 of 626 rows ("העברות")
];

/**
 * Currency the account was actually billed in, as opposed to the currency the
 * purchase was made in. Populates {@link ITransaction.chargedCurrency}.
 *
 * Absent is indistinguishable at read time from "no conversion happened", so
 * dropping it silently mis-reads a foreign charge. Normalised through the same
 * path as `currency`, so the symbol "₪" resolves to `ILS`.
 *
 * `paymentCurrency` is deliberately NOT listed. Max is the only institution
 * that sends it and its value is the ISO-4217 *numeric* code ("376"), not a
 * currency a caller can read; aliasing it would publish `chargedCurrency:
 * "376"`. `currencyId` matches no institution at all.
 */
const CHARGED_CURRENCY_FIELDS: string[] = [
  'debCrdCurrencySymbol', // VisaCal — 1305 of 1305 rows
  'billingAmountCurrencySymbol', // Isracard / Amex — 285 of 285 rows
];

/** The three provider-annotation groups, in dictionary shape. */
const PROVIDER_ANNOTATION_FIELDS = {
  memo: MEMO_FIELDS,
  category: CATEGORY_FIELDS,
  chargedCurrency: CHARGED_CURRENCY_FIELDS,
} satisfies Record<string, string[]>;

export default PROVIDER_ANNOTATION_FIELDS;
