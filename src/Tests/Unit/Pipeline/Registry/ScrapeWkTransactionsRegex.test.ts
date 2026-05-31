/**
 * Regression coverage for `PIPELINE_WELL_KNOWN_API.transactions`.
 *
 * <p>Bug reproduced 2026-05-05 on Amex E2E happy-path:
 *   - The auto-discover picked GET `…/DigitalV3.StatusPage/GetTransactionsContent`
 *     (UI text labels / approval indicators) as the transaction endpoint
 *     because the regex `/getTransactions/i` matches the
 *     `GetTransactions…` prefix in `GetTransactionsContent`.
 *   - The actual transaction endpoint POST
 *     `…/DigitalV3.StatusPage/GetLatestTransactions` was filtered OUT
 *     of URL matches because `getTransactions` does NOT appear as a
 *     contiguous substring (the word `Latest` sits between `Get` and
 *     `Transactions`). With only the GET endpoint surviving the URL
 *     filter, `discoverShapeAware`'s POST-with-shape preference never
 *     gets a chance to pick the right one.
 *
 * <p>The contract these tests pin:
 *   - The regex set MUST match the real Amex/Isracard transaction
 *     endpoint `GetLatestTransactions`.
 *   - The regex set MUST also match the existing card-family list
 *     endpoint `GetTransactionsList` (Isracard).
 *   - It is acceptable for the UI-content endpoint
 *     `GetTransactionsContent` to also match — `discoverShapeAware`
 *     prefers POST-with-shape over GET-without-shape. What is NOT
 *     acceptable is missing the real endpoint entirely.
 */

import { PIPELINE_WELL_KNOWN_API } from '../../../../Scrapers/Pipeline/Registry/WK/ScrapeWK.js';

/** Whether any pattern in the list matches the URL. */
type DoesPatternsMatch = boolean;

/**
 * Returns true when at least one regex in `PIPELINE_WELL_KNOWN_API.transactions`
 * matches the candidate URL.
 * @param url - Candidate endpoint URL.
 * @returns Whether any registered pattern matches.
 */
function anyTxnPatternMatches(url: string): DoesPatternsMatch {
  return PIPELINE_WELL_KNOWN_API.transactions.some((p): boolean => p.test(url));
}

describe('PIPELINE_WELL_KNOWN_API.transactions — Amex/Isracard real-bank URLs', () => {
  it('matches Amex POST GetLatestTransactions (the real txn endpoint)', () => {
    const amexLatestTxnsUrl =
      'https://web.americanexpress.co.il/ocp/statuspage/DigitalV3.StatusPage/GetLatestTransactions';
    const isLatestMatched = anyTxnPatternMatches(amexLatestTxnsUrl);
    expect(isLatestMatched).toBe(true);
  });

  it('matches Isracard POST GetLatestTransactions (same backend family)', () => {
    const isracardLatestUrl =
      'https://web.isracard.co.il/ocp/statuspage/DigitalV3.StatusPage/GetLatestTransactions';
    const isLatestMatched = anyTxnPatternMatches(isracardLatestUrl);
    expect(isLatestMatched).toBe(true);
  });

  it('matches Isracard POST GetTransactionsList (existing card-family list endpoint)', () => {
    const isracardListUrl =
      'https://web.isracard.co.il/ocp/transactions/DigitalV3.Transactions/GetTransactionsList';
    const isListMatched = anyTxnPatternMatches(isracardListUrl);
    expect(isListMatched).toBe(true);
  });
});
