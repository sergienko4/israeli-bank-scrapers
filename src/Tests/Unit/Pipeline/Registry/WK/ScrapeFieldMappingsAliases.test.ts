/**
 * Phase F — alias-presence asserts for the cross-bank dedup + identifier
 * extraction fix. Every Israeli bank's API emits a stable per-txn
 * identifier (Asmachta / seqVoucherNumber / Urn / runtimeReferenceId /
 * confirmationNumber / reference / referenceNumber / uid / arn /
 * authorizationNumber / trnIntId). The `WK.identifier` alias table
 * must list every shape so `findFieldValue` resolves the correct
 * field; `WK.amount` must list `ilsBillingAmount` so Isracard's
 * `approvedTransactions` rows surface their real amount instead of
 * 0 (auto-mapper falls back to `creditAmount - debitAmount = 0` when
 * no alias matches).
 *
 * Failing-test-first per debugging-guidlines §B.1 — these RED on the
 * current tree and turn GREEN with the alias additions.
 */

import { PIPELINE_WELL_KNOWN_TXN_FIELDS as WK } from '../../../../../Scrapers/Pipeline/Registry/WK/ScrapeFieldMappings.js';

describe('WK.identifier — cross-bank per-txn identifier aliases', () => {
  const requiredAliases: readonly string[] = [
    'seqVoucherNumber', // Isracard / Amex — Asmachta-like
    'voucherNumber', // Isracard / Amex — backup ID
    'seqConfirmationNumber', // Isracard approvedTransactions
    'confirmationNumber', // Isracard approvedTransactions — already present
    'uid', // Max — long base-X transaction UID
    'arn', // Max — acquirer reference number
    'authorizationNumber', // Max — bank authorization id
    'Urn', // Discount — operation URN
    'runtimeReferenceId', // Max — runtimeReference.id top-level alias
    'trnIntId', // VisaCal — already present
    'counter', // Beinleumi — per-row running sequence number
    'reference', // Beinleumi — coarse fallback for pre-2026-08-10 responses
    'referenceNumber', // Hapoalim — already present
  ];
  const aliasRows = requiredAliases.map((alias): readonly [string] => [alias]);

  it.each(aliasRows)('WK_identifier_%s_ShouldBeListed', alias => {
    expect(WK.identifier).toContain(alias);
  });

  it('WK_identifier_Counter_ShouldOutrankReference', () => {
    const counterRank = WK.identifier.indexOf('counter');
    const referenceRank = WK.identifier.indexOf('reference');
    expect(counterRank).toBeGreaterThanOrEqual(0);
    expect(counterRank).toBeLessThan(referenceRank);
  });
});

describe('WK.amount — Isracard approvedTransactions amount alias', () => {
  it('WK_amount_IlsBillingAmount_ShouldBeListed', () => {
    expect(WK.amount).toContain('ilsBillingAmount');
  });
});
