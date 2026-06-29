/**
 * Phase 7d — proves the TXN ↔ ACCOUNT WK split. The two
 * dictionaries own distinct concerns; cross-pollution across the
 * boundary regresses the contract that ACCOUNT-RESOLVE owns
 * account-side fields and SCRAPE owns transaction-side fields.
 */

import {
  PIPELINE_WELL_KNOWN_ACCOUNT_FIELDS as WK_ACCT,
  PIPELINE_WELL_KNOWN_TXN_FIELDS as WK_TXN,
} from '../../../../../Scrapers/Pipeline/Registry/WK/ScrapeWK.js';

describe('PIPELINE_WELL_KNOWN_ACCOUNT_FIELDS — Phase 7d separation', () => {
  it('exposes the 6 WK container names in card-then-bank-account order', () => {
    expect(WK_ACCT.containers).toEqual([
      'cardsList',
      'cards',
      'accounts',
      'bankAccounts',
      'accountsItems',
      'DataEntity',
    ]);
  });

  it('combined id list is non-empty and includes both query and display ids', () => {
    expect(WK_ACCT.id.length).toBeGreaterThan(0);
    expect(WK_ACCT.queryId.length).toBeGreaterThan(0);
    expect(WK_ACCT.displayId.length).toBeGreaterThan(0);
    expect(WK_ACCT.id).toEqual([...WK_ACCT.queryId, ...WK_ACCT.displayId]);
  });

  it('queryId carries cardUniqueId (Phase 7d invariant)', () => {
    expect(WK_ACCT.queryId).toContain('cardUniqueId');
  });

  it('displayId carries last4Digits (Phase 7d invariant)', () => {
    expect(WK_ACCT.displayId).toContain('last4Digits');
  });
});

describe('PIPELINE_WELL_KNOWN_TXN_FIELDS — account fields removed in Phase 7d', () => {
  it('no longer exposes accountContainers (moved to WK_ACCOUNT)', () => {
    const txnAsRecord = WK_TXN as unknown as Record<string, readonly string[] | undefined>;
    expect(txnAsRecord.accountContainers).toBeUndefined();
  });

  it('no longer exposes accountId (moved to WK_ACCOUNT.id)', () => {
    const txnAsRecord = WK_TXN as unknown as Record<string, readonly string[] | undefined>;
    expect(txnAsRecord.accountId).toBeUndefined();
  });

  it('no longer exposes displayId (moved to WK_ACCOUNT.displayId)', () => {
    const txnAsRecord = WK_TXN as unknown as Record<string, readonly string[] | undefined>;
    expect(txnAsRecord.displayId).toBeUndefined();
  });

  it('no longer exposes queryId (moved to WK_ACCOUNT.queryId)', () => {
    const txnAsRecord = WK_TXN as unknown as Record<string, readonly string[] | undefined>;
    expect(txnAsRecord.queryId).toBeUndefined();
  });

  it('still exposes txn-side fields date/amount/txnContainers', () => {
    expect(WK_TXN.date.length).toBeGreaterThan(0);
    expect(WK_TXN.amount.length).toBeGreaterThan(0);
    expect(WK_TXN.txnContainers.length).toBeGreaterThan(0);
  });
});
