/**
 * TxnEndpointBridge — covers the four pure-read functions that adapt
 * the DASHBOARD-committed `ctx.txnEndpoint` shape onto the runtime
 * `IDiscoveredEndpoint` shape consumed by SCRAPE strategies. Phase 7e
 * removed every `network.discoverTransactionsEndpoint()` fallback in
 * SCRAPE; this test pins the contract: when the option is committed
 * the bridge unwraps it; when absent every reader returns `false`.
 */

import {
  adaptTxnEndpointToDiscovered,
  readBillingUrl,
  readPendingUrl,
  readTxnEndpoint,
} from '../../../../../Scrapers/Pipeline/Mediator/Scrape/TxnEndpointBridge.js';
import { none, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { ITxnEndpoint } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';

const SAMPLE_BODY: Readonly<Record<string, unknown>> = { transactions: [{ id: 'fake' }] };

const SAMPLE: ITxnEndpoint = {
  url: 'https://example.test/api/txns',
  method: 'POST',
  captureIndex: 7,
  templatePostData: '{"q":"x"}',
  responseBodySample: SAMPLE_BODY,
  normalizedRecords: [],
  fieldMap: {
    date: 'eventDate',
    amount: 'eventAmount',
    description: 'eventDescription',
    currency: 'currency',
    identifier: 'transactionId',
    originalAmount: false,
    processedDate: false,
    balance: false,
  },
  pendingUrl: 'https://example.test/api/pending',
  billingUrl: 'https://example.test/api/billing',
};

describe('TxnEndpointBridge — Phase 7e read-bridge', () => {
  describe('adaptTxnEndpointToDiscovered', () => {
    it('translates ITxnEndpoint → IDiscoveredEndpoint with field renames', () => {
      const out = adaptTxnEndpointToDiscovered(SAMPLE);
      expect(out.url).toBe(SAMPLE.url);
      expect(out.method).toBe('POST');
      expect(out.postData).toBe('{"q":"x"}');
      expect(out.responseBody).toBe(SAMPLE_BODY);
      expect(out.contentType).toBe('application/json');
      expect(out.requestHeaders).toEqual({});
      expect(out.responseHeaders).toEqual({});
      expect(out.timestamp).toBe(0);
      expect(out.captureIndex).toBe(7);
    });

    it('maps templatePostData=false to empty postData (GET endpoints)', () => {
      const getEp: ITxnEndpoint = { ...SAMPLE, method: 'GET', templatePostData: false };
      const out = adaptTxnEndpointToDiscovered(getEp);
      expect(out.method).toBe('GET');
      expect(out.postData).toBe('');
    });
  });

  describe('readTxnEndpoint', () => {
    it('returns the adapted runtime endpoint when ctx has a committed value', () => {
      const someCtx = some(SAMPLE);
      const out = readTxnEndpoint({ txnEndpoint: someCtx });
      expect(out).not.toBe(false);
      if (out !== false) {
        expect(out.url).toBe(SAMPLE.url);
        expect(out.captureIndex).toBe(7);
      }
    });

    it('returns false when ctx.txnEndpoint is none', () => {
      const noneCtx = none();
      const out = readTxnEndpoint({ txnEndpoint: noneCtx });
      expect(out).toBe(false);
    });

    it('returns false when ctx.txnEndpoint is undefined (legacy mock surfaces)', () => {
      const out = readTxnEndpoint({});
      expect(out).toBe(false);
    });
  });

  describe('readPendingUrl', () => {
    it('returns the pre-resolved pending URL when the option is committed', () => {
      const someCtx = some(SAMPLE);
      const out = readPendingUrl({ txnEndpoint: someCtx });
      expect(out).toBe('https://example.test/api/pending');
    });

    it('returns false when no endpoint is committed', () => {
      const noneCtx = none();
      const fromNone = readPendingUrl({ txnEndpoint: noneCtx });
      expect(fromNone).toBe(false);
      const fromUndef = readPendingUrl({});
      expect(fromUndef).toBe(false);
    });

    it('passes through pendingUrl=false (DASHBOARD found no pending widget)', () => {
      const ep: ITxnEndpoint = { ...SAMPLE, pendingUrl: false };
      const someCtx = some(ep);
      const out = readPendingUrl({ txnEndpoint: someCtx });
      expect(out).toBe(false);
    });
  });

  describe('readBillingUrl', () => {
    it('returns the pre-resolved billing URL when the option is committed', () => {
      const someCtx = some(SAMPLE);
      const out = readBillingUrl({ txnEndpoint: someCtx });
      expect(out).toBe('https://example.test/api/billing');
    });

    it('returns false when no endpoint is committed', () => {
      const noneCtx = none();
      const fromNone = readBillingUrl({ txnEndpoint: noneCtx });
      expect(fromNone).toBe(false);
      const fromUndef = readBillingUrl({});
      expect(fromUndef).toBe(false);
    });

    it('passes through billingUrl=false (non-credit-card banks)', () => {
      const ep: ITxnEndpoint = { ...SAMPLE, billingUrl: false };
      const someCtx = some(ep);
      const out = readBillingUrl({ txnEndpoint: someCtx });
      expect(out).toBe(false);
    });
  });
});
