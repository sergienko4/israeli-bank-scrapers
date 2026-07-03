/**
 * BaNCS (Yahav) transaction-endpoint discovery — synthetic, PII-free.
 *
 * <p>Integration proof for slice J1: a TCS BaNCS CURRENT_ACCOUNT txn
 * request is served from `POST …/account` — a URL that matches NO WK
 * `transactions` pattern — so the URL-only picker used to return `false`
 * ("DASHBOARD_TXN_ENDPOINT_MISSING"). The default-deny
 * {@link isBancsTxnCapture} admission (wired into
 * `ShapeAware.filterPoolMatches`) now lets the picker recognise it by
 * request-body shape and commit it at the `replayablePost` /
 * `preClickFallback` tier.
 *
 * <p>Also pins the default-deny boundary: the portfolioBalance and
 * account-details requests (same `/account` URL, different body) are NOT
 * picked, so they can never shadow the real txn capture. The cross-bank
 * safelist stays in {@link "./PickerPreClickFallback.test.ts"}.
 *
 * Every value is fabricated — no real account data appears.
 */

import { createFrozenNetwork } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscoveryTypes.js';

const ACCOUNT_URL = 'https://digital.bank.fake.example/BaNCSDigitalApp/account';

/** A minimal BaNCS txn response body (one fabricated record). */
const TXN_RESPONSE: Readonly<Record<string, unknown>> = {
  Payload: { DataEntity: [{ OrigDt: { Day: 1, Month: 1, Year: 2026 }, Memo: 'X' }] },
};

/**
 * Build one BaNCS `OrigDt` date-range bound.
 * @param day - Day-of-month for the bound (fabricated).
 * @param operator - BaNCS range operator (GREATERTHANOREQUAL / …).
 * @returns A synthetic inner-filter record.
 */
function origDtBound(day: number, operator: string): Record<string, unknown> {
  return { OrigDt: { Day: day, Month: 1, Year: 2026 }, Operator: operator };
}

/**
 * Build a CURRENT_ACCOUNT transactions request body with a from/to range.
 * @returns A synthetic BaNCS transactions request body.
 */
function txnBody(): Record<string, unknown> {
  const from = origDtBound(1, 'GREATERTHANOREQUAL');
  const to = origDtBound(31, 'LESSTHANOREQUAL');
  return { Payload: { Category: ['CURRENT_ACCOUNT'], Filters: [{ Filters: [from, to] }] } };
}

/**
 * Build the portfolioBalance request body (Category set, NO Filters).
 * @returns A synthetic BaNCS balance request body.
 */
function balanceBody(): Record<string, unknown> {
  return { Payload: { Category: ['portfolioBalance'] } };
}

/**
 * Build a BaNCS `POST /account` capture (body drives recognition).
 * @param timestamp - Capture timestamp (splits pre/post-nav).
 * @param body - Request body serialised into `postData`.
 * @param responseBody - Response body for the capture (default empty).
 * @returns A synthetic IDiscoveredEndpoint.
 */
function makeBancsCapture(
  timestamp: number,
  body: Record<string, unknown>,
  responseBody: Readonly<Record<string, unknown>> = {},
): IDiscoveredEndpoint {
  return {
    url: ACCOUNT_URL,
    method: 'POST',
    postData: JSON.stringify(body),
    contentType: 'application/json',
    requestHeaders: {},
    responseHeaders: {},
    responseBody,
    timestamp,
  };
}

describe('discoverTransactionsEndpoint — BaNCS body-shape admission (slice J1)', () => {
  const clickAt = 1_000_000_000_000;
  const preClickTs = clickAt - 5_000;
  const postClickTs = clickAt + 5_000;

  it('picks a BaNCS CURRENT_ACCOUNT /account POST from the pre-click pool', () => {
    const body = txnBody();
    const txn = makeBancsCapture(preClickTs, body, TXN_RESPONSE);
    const network = createFrozenNetwork([txn], false, clickAt);
    const picked = network.discoverTransactionsEndpoint();
    expect(picked).not.toBe(false);
    if (picked !== false) {
      expect(picked.url).toBe(ACCOUNT_URL);
      expect(picked.capturedPreClick).toBe(true);
      expect(picked.pickerTier).toBe('preClickFallback');
    }
  });

  it('picks a BaNCS CURRENT_ACCOUNT /account POST from the post-click pool', () => {
    const body = txnBody();
    const txn = makeBancsCapture(postClickTs, body, TXN_RESPONSE);
    const network = createFrozenNetwork([txn], false, clickAt);
    const picked = network.discoverTransactionsEndpoint();
    expect(picked).not.toBe(false);
    if (picked !== false) {
      expect(picked.pickerTier).toBe('replayablePost');
    }
  });

  it('does NOT pick a BaNCS portfolioBalance /account POST (default-deny)', () => {
    const body = balanceBody();
    const balance = makeBancsCapture(postClickTs, body);
    const network = createFrozenNetwork([balance], false, clickAt);
    const picked = network.discoverTransactionsEndpoint();
    expect(picked).toBe(false);
  });

  it('does NOT pick a BaNCS account-details /account POST with no Category', () => {
    const details = makeBancsCapture(postClickTs, { Payload: { Operation: 'INQ' } });
    const network = createFrozenNetwork([details], false, clickAt);
    const picked = network.discoverTransactionsEndpoint();
    expect(picked).toBe(false);
  });

  it('prefers the txn capture over a balance capture on the same URL', () => {
    const balBody = balanceBody();
    const balance = makeBancsCapture(preClickTs, balBody);
    const body = txnBody();
    const txn = makeBancsCapture(postClickTs, body, TXN_RESPONSE);
    const network = createFrozenNetwork([balance, txn], false, clickAt);
    const picked = network.discoverTransactionsEndpoint();
    expect(picked).not.toBe(false);
    if (picked !== false) {
      expect(picked.postData).toContain('CURRENT_ACCOUNT');
      expect(picked.postData).toContain('OrigDt');
    }
  });
});
