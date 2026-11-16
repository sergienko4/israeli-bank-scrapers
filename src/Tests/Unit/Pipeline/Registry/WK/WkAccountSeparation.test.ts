/**
 * The SCRAPE transaction dictionary never carries account-side fields; those
 * live in the account-resolution layer.
 */

import { PIPELINE_WELL_KNOWN_TXN_FIELDS as WK_TXN } from '../../../../../Scrapers/Pipeline/Registry/WK/ScrapeWK.js';

describe('PIPELINE_WELL_KNOWN_TXN_FIELDS — no account fields', () => {
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
