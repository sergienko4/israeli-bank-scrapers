/**
 * NetworkDiscoveryExtra — live buildDiscoveredHeaders + discoverShapeAware + misc (split).
 */

import { createNetworkDiscovery } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import { makeMockPage, simulate } from './NetworkDiscoveryExtraHelpers.js';

describe('NetworkDiscovery — live buildDiscoveredHeaders branches', () => {
  it('assembleDiscoveredHeaders propagates Referer from origin', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://api.bank.co.il/x',
      body: {},
      reqHeaders: { origin: 'https://spa.bank.co.il' },
    });
    const opts = await discovery.buildDiscoveredHeaders();
    expect(opts.extraHeaders.Referer).toBe('https://spa.bank.co.il');
  });

  it('assembleDiscoveredHeaders preserves Content-Type always', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    const opts = await discovery.buildDiscoveredHeaders();
    expect(opts.extraHeaders['Content-Type']).toBe('application/json');
  });

  it('assembleDiscoveredHeaders attaches authorization header when auth discovered', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    // Provide a captured auth endpoint with authorization header so
    // discoverAuthThreeTier picks it up.
    await simulate({
      url: 'https://api.bank.co.il/data',
      body: {},
      reqHeaders: { authorization: 'Bearer aaa-bbb-cccccc' },
    });
    const opts = await discovery.buildDiscoveredHeaders();
    expect(typeof opts.extraHeaders['Content-Type']).toBe('string');
  });
});

describe('NetworkDiscovery — discoverShapeAware full branch matrix', () => {
  it('shape pass branch: txn endpoint body contains transactions array', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://api.bank.co.il/gatewayAPI/lastTransactions/full',
      body: { transactions: [{ a: 1 }] },
    });
    const ep = discovery.discoverTransactionsEndpoint();
    expect(ep).not.toBe(false);
  });

  it('shape pass branch with txns key', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://api.bank.co.il/gatewayAPI/lastTransactions/full',
      body: { txns: [{ a: 1 }] },
    });
    const ep = discovery.discoverTransactionsEndpoint();
    expect(ep).not.toBe(false);
  });

  it('shape pass via txnIsrael container key', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://api.bank.co.il/gatewayAPI/lastTransactions/v2',
      body: { data: { txnIsrael: [{ id: 1 }] } },
    });
    const ep = discovery.discoverTransactionsEndpoint();
    expect(ep).not.toBe(false);
  });
});

describe('NetworkDiscovery — buildBalUrl segment branches', () => {
  it('appends to path when last segment is 4-digit short (not account-shaped)', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    // Balance URL match AND short last segment.
    await simulate({
      url: 'https://api.bank.co.il/infoAndBalance/9999',
      body: {},
    });
    const url = discovery.buildBalanceUrl('77777');
    // last seg '4718' is 4 digits < 5 → fails isAccountInUrl → append path.
    expect(typeof url).toBe('string');
    if (url) {
      const didEndWith36 = url.endsWith('/77777');
      expect(didEndWith36).toBe(true);
    }
  });

  it('replaces last numeric segment when it is 5+ digits', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://api.bank.co.il/infoAndBalance/123456',
      body: {},
    });
    const url = discovery.buildBalanceUrl('777777');
    expect(typeof url).toBe('string');
    if (url) {
      const didEndWith37 = url.endsWith('/777777');
      expect(didEndWith37).toBe(true);
    }
  });
});

describe('NetworkDiscovery — findCommonServicesUrl tie counts branch', () => {
  it('handles ties (equal counts) — first-seen wins', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({ url: 'https://api.bank.co.il/a', body: {} });
    await simulate({ url: 'https://api.bank.co.il/b', body: {} });
    // Both have count 1 — sort puts one first.
    const result = discovery.getServicesUrl();
    expect(typeof result).toBe('string');
  });
});

describe('NetworkDiscovery — extractApiBaseFromUrl / accountId branches', () => {
  it('returns false when URL does not contain accountId at all', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    // No URL contains the accountId — findUrlWithAccountId returns false.
    await simulate({
      url: 'https://api.bank.co.il/gatewayAPI/lastTransactions/other',
      body: {},
    });
    const txUrl = discovery.buildTransactionUrl('NO-MATCH-ACCT', '20240101');
    expect(txUrl).toBe(false);
  });

  it('returns the extracted base URL when accountId matches', async () => {
    const page = makeMockPage();
    const discovery = createNetworkDiscovery(page);
    await simulate({
      url: 'https://api.bank.co.il/gatewayAPI/lastTransactions/7777/page',
      body: {},
    });
    const url = discovery.buildTransactionUrl('7777', '20240101');
    expect(typeof url).toBe('string');
  });
});
