/**
 * WellKnown account-id field tuples — split out of
 * {@link PIPELINE_WELL_KNOWN_ACCOUNT_FIELDS} to keep ScrapeFieldMappings.ts
 * under the 150-line max-lines ceiling.
 *
 * <p>Display-id ordering matters: card-suffix-like fields (4-digit card
 * identifiers used as POST body params on the card-family banks) come
 * BEFORE bank-account-number fields. Otherwise findFieldValue matches
 * `accountNumber` on a card record that also carries `cardSuffix`, and
 * per-card POST replays would carry the wrong identifier.
 *
 * <p>`card4Number` covers Amex/Isracard per-card POST bodies;
 * `bankAccountUniqueId` (lowercase-d) covers VisaCal per balance-prover
 * cycle-6 evidence under `c:\tmp\runs\pipeline\{amex,isracard,visacal}\`.
 */
export const DISPLAY_ID_FIELDS = [
  'last4Digits',
  'cardSuffix',
  'cardLast4',
  'shortCardNumber',
  'AccountID',
  'accountNumber',
  'cardNumber',
  'bankAccountNum',
  'displayId',
  'account',
  'card4Number',
] as const;

export const QUERY_ID_FIELDS = [
  'cardUniqueId',
  'cardUniqueID',
  'bankAccountUniqueID',
  'bankAccountUniqueId',
  'accountId',
  'CardId',
  'cardIndex',
] as const;
