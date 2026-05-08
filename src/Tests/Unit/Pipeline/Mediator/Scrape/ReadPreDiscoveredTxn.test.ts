/**
 * Phase 7f — `readPreDiscoveredTxn(ctx)` unit test.
 *
 * <p>Mirrors the existing `readPreDiscoveredAccounts` reader test
 * pattern. SCRAPE consumes the slim `ITxnEndpoint` contract via this
 * pure-read helper; the EMPTY default is returned when the option is
 * absent (legacy mock contexts) or none.
 */

import {
  EMPTY_TXN_ENDPOINT,
  EMPTY_TXN_HARVEST,
  readDashboardTxnHarvest,
  readPreDiscoveredTxn,
} from '../../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapePhaseActions.js';
import { none, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IDashboardTxnHarvest,
  IPipelineContext,
  ITxnEndpoint,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
// `none` returns `INone` directly — no generic; satisfies the
// `txnEndpoint: Option<ITxnEndpoint>` contract via discriminated union.

const FAKE_ENDPOINT: ITxnEndpoint = {
  url: 'https://bank.fake.example/api/txns',
  method: 'POST',
  templatePostData: '{"cardUniqueId":"FAKE-1"}',
  fieldMap: EMPTY_TXN_ENDPOINT.fieldMap,
  pendingUrl: 'https://bank.fake.example/api/pending',
  billingUrl: 'https://bank.fake.example/api/billing',
};

describe('readPreDiscoveredTxn', () => {
  it('returns the slim endpoint committed by DASHBOARD.FINAL', () => {
    const txnOpt = some(FAKE_ENDPOINT);
    const ctx = { txnEndpoint: txnOpt } as unknown as IPipelineContext;
    const result = readPreDiscoveredTxn(ctx);
    expect(result.url).toBe(FAKE_ENDPOINT.url);
    expect(result.method).toBe('POST');
    expect(result.pendingUrl).toBe(FAKE_ENDPOINT.pendingUrl);
    expect(result.billingUrl).toBe(FAKE_ENDPOINT.billingUrl);
  });

  it('returns EMPTY_TXN_ENDPOINT when the option is none', () => {
    const noneOpt = none();
    const ctx = { txnEndpoint: noneOpt } as unknown as IPipelineContext;
    const result = readPreDiscoveredTxn(ctx);
    expect(result).toBe(EMPTY_TXN_ENDPOINT);
    expect(result.url).toBe('');
  });

  it('returns EMPTY_TXN_ENDPOINT when ctx has no txnEndpoint at all (legacy mocks)', () => {
    const ctx = {} as unknown as IPipelineContext;
    const result = readPreDiscoveredTxn(ctx);
    expect(result).toBe(EMPTY_TXN_ENDPOINT);
  });
});

describe('readDashboardTxnHarvest', () => {
  const fakeHarvest: IDashboardTxnHarvest = {
    records: [],
    capturedAccountId: 'FAKE-ACCT-1',
    multiAccountScope: false,
  };

  it('returns the harvest committed by DASHBOARD.FINAL when option is some', () => {
    const opt = some(fakeHarvest);
    const ctx = { dashboardTxnHarvest: opt } as unknown as IPipelineContext;
    const result = readDashboardTxnHarvest(ctx);
    expect(result).toBe(fakeHarvest);
  });

  it('returns EMPTY_TXN_HARVEST when the option is none', () => {
    const noneOpt = none();
    const ctx = { dashboardTxnHarvest: noneOpt } as unknown as IPipelineContext;
    const result = readDashboardTxnHarvest(ctx);
    expect(result).toBe(EMPTY_TXN_HARVEST);
  });

  it('returns EMPTY_TXN_HARVEST when ctx has no dashboardTxnHarvest at all (legacy mocks)', () => {
    const ctx = {} as unknown as IPipelineContext;
    const result = readDashboardTxnHarvest(ctx);
    expect(result).toBe(EMPTY_TXN_HARVEST);
  });
});
