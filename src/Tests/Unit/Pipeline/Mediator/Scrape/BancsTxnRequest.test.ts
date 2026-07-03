/**
 * BaNCS (Yahav) transaction-request recognition — synthetic, PII-free.
 *
 * <p>Proves {@link isBancsTxnCapture} / {@link isBancsTxnBody} recognise a
 * TCS BaNCS CURRENT_ACCOUNT date-range transactions request by its body
 * discriminators (`Payload.Category` including `CURRENT_ACCOUNT` AND a
 * `Payload.Filters[].Filters[].OrigDt {Day,Month,Year}` range), and that
 * they default-deny (`false`) for the portfolioBalance / account-details
 * requests that share the same `/account` URL — plus every non-BaNCS
 * capture. That default-deny keeps the URL-only txn picker + the
 * DASHBOARD gate unchanged for the other pipeline banks.
 *
 * Every value is fabricated — no real account data appears.
 */

import {
  isBancsTxnBody,
  isBancsTxnCapture,
} from '../../../../../Scrapers/Pipeline/Mediator/Scrape/Bancs/BancsTxnRequest.js';

const ACCOUNT_URL = 'https://digital.bank.fake.example/BaNCSDigitalApp/account';

/**
 * Build one BaNCS `OrigDt` date-range bound.
 * @param day - Day-of-month for the bound (fabricated).
 * @param operator - BaNCS range operator (GREATERTHANOREQUAL / …).
 * @returns A synthetic inner-filter record.
 */
function origDtBound(day: number, operator: string): Record<string, unknown> {
  return { Ver: 'x', OrigDt: { Ver: 'x', Day: day, Month: 1, Year: 2026 }, Operator: operator };
}

/**
 * Build a CURRENT_ACCOUNT transactions request body with a from/to range.
 * @returns A synthetic BaNCS transactions request body.
 */
function txnBody(): Record<string, unknown> {
  const from = origDtBound(1, 'GREATERTHANOREQUAL');
  const to = origDtBound(31, 'LESSTHANOREQUAL');
  return {
    Payload: {
      Operation: 'INQ',
      Category: ['CURRENT_ACCOUNT'],
      Filters: [{ Filters: [from, to] }],
    },
  };
}

/**
 * Build the portfolioBalance request body (Category set, NO Filters).
 * @returns A synthetic BaNCS balance request body.
 */
function balanceBody(): Record<string, unknown> {
  return { Payload: { Operation: 'INQ', Category: ['portfolioBalance'] } };
}

/**
 * Build the account-details request body (NO Category, NO Filters).
 * @returns A synthetic BaNCS account-details request body.
 */
function detailsBody(): Record<string, unknown> {
  return { Payload: { Operation: 'INQ' } };
}

/**
 * Build a capture surface from a url and request body.
 * @param url - Captured request URL.
 * @param body - Request body to stringify into `postData`.
 * @returns A minimal capture surface (url + postData).
 */
function capture(url: string, body: Record<string, unknown>): { url: string; postData: string } {
  return { url, postData: JSON.stringify(body) };
}

describe('BancsTxnRequest — isBancsTxnBody (two-part body guard)', () => {
  it('when_current_account_with_date_range_should_be_txn_body', () => {
    const body = txnBody();
    const isTxn = isBancsTxnBody(body);
    expect(isTxn).toBe(true);
  });

  it('when_portfolio_balance_body_should_default_deny', () => {
    const body = balanceBody();
    const isTxn = isBancsTxnBody(body);
    expect(isTxn).toBe(false);
  });

  it('when_account_details_body_no_category_should_default_deny', () => {
    const body = detailsBody();
    const isTxn = isBancsTxnBody(body);
    expect(isTxn).toBe(false);
  });

  it('when_current_account_without_date_range_should_default_deny', () => {
    const body = { Payload: { Operation: 'INQ', Category: ['CURRENT_ACCOUNT'] } };
    const isTxn = isBancsTxnBody(body);
    expect(isTxn).toBe(false);
  });

  it('when_current_account_with_incomplete_origdt_should_default_deny', () => {
    const body = {
      Payload: {
        Category: ['CURRENT_ACCOUNT'],
        Filters: [{ Filters: [{ OrigDt: { Day: 1, Month: 1 }, Operator: 'GE' }] }],
      },
    };
    const isTxn = isBancsTxnBody(body);
    expect(isTxn).toBe(false);
  });
});

describe('BancsTxnRequest — isBancsTxnCapture (url + body, default-deny)', () => {
  it('when_account_url_with_txn_body_should_recognise', () => {
    const body = txnBody();
    const cap = capture(ACCOUNT_URL, body);
    const isTxn = isBancsTxnCapture(cap);
    expect(isTxn).toBe(true);
  });

  it('when_account_url_has_query_string_should_still_recognise', () => {
    const body = txnBody();
    const cap = capture(`${ACCOUNT_URL}?ts=1`, body);
    const isTxn = isBancsTxnCapture(cap);
    expect(isTxn).toBe(true);
  });

  it('when_balance_capture_should_default_deny', () => {
    const body = balanceBody();
    const cap = capture(ACCOUNT_URL, body);
    const isTxn = isBancsTxnCapture(cap);
    expect(isTxn).toBe(false);
  });

  it('when_details_capture_should_default_deny', () => {
    const body = detailsBody();
    const cap = capture(ACCOUNT_URL, body);
    const isTxn = isBancsTxnCapture(cap);
    expect(isTxn).toBe(false);
  });

  it('when_txn_body_but_wrong_url_should_default_deny', () => {
    const wrongUrl = 'https://digital.bank.fake.example/BaNCSDigitalApp/portfolio';
    const body = txnBody();
    const cap = capture(wrongUrl, body);
    const isTxn = isBancsTxnCapture(cap);
    expect(isTxn).toBe(false);
  });

  it('when_post_data_empty_should_default_deny', () => {
    const isTxn = isBancsTxnCapture({ url: ACCOUNT_URL, postData: '' });
    expect(isTxn).toBe(false);
  });

  it('when_post_data_not_json_should_default_deny', () => {
    const isTxn = isBancsTxnCapture({ url: ACCOUNT_URL, postData: 'not-json' });
    expect(isTxn).toBe(false);
  });

  it('when_non_bancs_bank_post_body_should_default_deny', () => {
    const other = { fromDate: '2026-01-01', toDate: '2026-03-31', accountId: '000' };
    const cap = capture('https://bank.fake.example/api/transactions', other);
    const isTxn = isBancsTxnCapture(cap);
    expect(isTxn).toBe(false);
  });
});
