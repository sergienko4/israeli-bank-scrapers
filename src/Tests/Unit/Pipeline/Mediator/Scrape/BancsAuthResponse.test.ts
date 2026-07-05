/**
 * BaNCS (Yahav) auth-response recognizer — synthetic, PII-free tests.
 *
 * <p>Proves {@link isBancsAuthResponse} recognizes an authenticated BaNCS
 * account-data capture by SHAPE — a `…/BaNCSDigitalApp/account` URL whose
 * JSON body carries the `Payload.DataEntity[]` envelope — and is
 * fail-closed (default-deny) for everything else, most importantly the
 * Imperva/BaNCS `לא ניתן להשלים בקשה` interstitial that BaNCS serves as
 * HTML with a 200 status (the Gap L page). No real account data appears.
 */

import {
  BANCS_ACCOUNT_URL,
  isBancsAuthResponse,
} from '../../../../../Scrapers/Pipeline/Mediator/Scrape/Bancs/BancsAuthResponse.js';

const BANCS_URL = 'https://digital.yahav.co.il/BaNCSDigitalApp/account';
const JSON_TYPE = 'application/json; charset=UTF-8';

/** A BaNCS envelope body carrying one (redacted) account entity. */
const ENVELOPE_BODY = {
  Payload: { DataEntity: [{ AccountId: { AcctIds: { IBAN: 'FAKE-IBAN' } } }] },
};

describe('isBancsAuthResponse — recognizes authed BaNCS account envelope', () => {
  it('returns true for a BaNCS /account JSON response with a DataEntity envelope', () => {
    const isAuth = isBancsAuthResponse({
      url: BANCS_URL,
      contentType: JSON_TYPE,
      responseBody: ENVELOPE_BODY,
    });
    expect(isAuth).toBe(true);
  });

  it('returns true for an authed-but-empty DataEntity array (query ran, no rows)', () => {
    const isAuth = isBancsAuthResponse({
      url: BANCS_URL,
      contentType: JSON_TYPE,
      responseBody: { Payload: { DataEntity: [] } },
    });
    expect(isAuth).toBe(true);
  });
});

describe('isBancsAuthResponse — fail-closed default-deny', () => {
  it('returns false for the HTML Imperva interstitial served with 200 (Gap L page)', () => {
    const isAuth = isBancsAuthResponse({
      url: BANCS_URL,
      contentType: 'text/html; charset=UTF-8',
      responseBody: '<TITLE>לא ניתן להשלים בקשה</TITLE>',
    });
    expect(isAuth).toBe(false);
  });

  it('returns false for JSON on the BaNCS URL that lacks the DataEntity envelope', () => {
    const isAuth = isBancsAuthResponse({
      url: BANCS_URL,
      contentType: JSON_TYPE,
      responseBody: { Payload: { SomethingElse: {} } },
    });
    expect(isAuth).toBe(false);
  });

  it('returns false for the envelope shape served from a non-BaNCS URL', () => {
    const isAuth = isBancsAuthResponse({
      url: 'https://web.isracard.co.il/api/GetCardList',
      contentType: JSON_TYPE,
      responseBody: ENVELOPE_BODY,
    });
    expect(isAuth).toBe(false);
  });

  it('returns false when the JSON body is a non-object (string) even on the BaNCS URL', () => {
    const isAuth = isBancsAuthResponse({
      url: BANCS_URL,
      contentType: JSON_TYPE,
      responseBody: 'unexpected-string-body',
    });
    expect(isAuth).toBe(false);
  });
});

describe('BANCS_ACCOUNT_URL — matches the multiplexed resource path', () => {
  it('matches the BaNCS /account URL and rejects a well-known accounts URL', () => {
    const isBancsUrlMatched = BANCS_ACCOUNT_URL.test(BANCS_URL);
    const isWkAccountsUrlMatched = BANCS_ACCOUNT_URL.test(
      'https://web.isracard.co.il/api/userAccountsData',
    );
    expect(isBancsUrlMatched).toBe(true);
    expect(isWkAccountsUrlMatched).toBe(false);
  });
});
