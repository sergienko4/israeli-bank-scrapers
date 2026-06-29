/**
 * Bank Yahav (BaNCS) account-number derivation.
 *
 * <p>Yahav's `/BaNCSDigitalApp/account` response surfaces the bank's
 * INTERNAL handle (`AccountId.iorId` / `AccountId.Id.Id`) where every
 * other bank surfaces a customer-facing account number. The real
 * customer account is the BaNCS portfolio `04131490974`, present at
 * `Payload.RefDataList[0].Id` AND as the leading 11-char run of
 * `Payload.DataEntity[0].AccountId.AcctIds.BANKACCOUNTID`
 * (`04131490974CA005ILS0001`). Stripping the `04` prefix yields the
 * 9-digit `131490974` → branch `131` + account `490974` → displayed
 * `131-490974`.
 *
 * <p>The derivation is structurally gated by {@link BANCS_PORTFOLIO_RE}
 * (`/^04\d{9}$/`): only Yahav's BaNCS responses carry an `04`+9-digit
 * portfolio, so a flat-account body (every other bank) is a no-op.
 *
 * <p>All identifiers, account numbers, and IBANs below are fabricated
 * test data that mirror the real BaNCS response shape.
 */

import { buildDiscoveryFromEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/AccountResolve/AccountFromPool.Picker.js';
import {
  BANCS_PORTFOLIO_RE,
  deriveBancsAccount,
  extractPortfolioId,
} from '../../../../../Scrapers/Pipeline/Mediator/AccountResolve/BancsPortfolioAccount.js';
import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscoveryTypes.js';
import { extractAccountRecords } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapeAutoMapper.js';

/**
 * Build a Yahav-shaped BaNCS account response body (fabricated data).
 * @returns Yahav `/BaNCSDigitalApp/account` response body.
 */
function makeYahavBody(): Record<string, unknown> {
  return {
    Payload: {
      RefDataList: [{ Ver: 'RefData_1.0.0', Type: 'CURRENT', IorIdAvble: true, Id: '04131490974' }],
      DataEntity: [
        {
          Ver: 'Account_1.0.0',
          Type: 'CURRENT',
          AccountId: {
            Ver: 'AccountIdentifier_1.0.0',
            IorIdAvble: true,
            AcctIds: { IBAN: 'IL810041310000000490974', BANKACCOUNTID: '04131490974CA005ILS0001' },
            Id: { Ver: 'Identifier_1.0.0', Id: '0001009529617' },
            iorId: 'n5jvJe',
          },
          IntrstRateDataList: [],
        },
      ],
    },
  };
}

/**
 * Build a flat (non-BaNCS) account body — the 18 other banks.
 * @returns A flat root-array account body with no `04`+9-digit portfolio.
 */
function makeFlatBody(): Record<string, unknown> {
  return { accounts: [{ accountNumber: '12345678', bankNumber: '12', balance: 100 }] };
}

/**
 * Wrap a response body in a minimal POST discovery endpoint.
 * @param responseBody - Parsed JSON response body to attach.
 * @returns A minimal {@link IDiscoveredEndpoint} for the picker.
 */
function makeEndpoint(responseBody: unknown): IDiscoveredEndpoint {
  return {
    url: 'https://digital.yahav.example/BaNCSDigitalApp/account',
    method: 'POST',
    postData: '{}',
    responseBody,
    contentType: 'application/json',
    requestHeaders: {},
    responseHeaders: {},
    timestamp: 100,
    captureIndex: 0,
  };
}

describe('extractPortfolioId', () => {
  it('finds the 04+9-digit portfolio in a Yahav RefDataList/BANKACCOUNTID body', () => {
    const yahavBody = makeYahavBody();
    const portfolio = extractPortfolioId(yahavBody);
    expect(portfolio).toBe('04131490974');
  });

  it('returns false for a flat-account body (no 04+9-digit portfolio)', () => {
    const flatBody = makeFlatBody();
    const portfolio = extractPortfolioId(flatBody);
    expect(portfolio).toBe(false);
  });

  it('regex matches a bare portfolio and rejects the internal handle', () => {
    const isPortfolio = BANCS_PORTFOLIO_RE.test('04131490974');
    const isHandle = BANCS_PORTFOLIO_RE.test('0001009529617');
    expect(isPortfolio).toBe(true);
    expect(isHandle).toBe(false);
  });
});

describe('deriveBancsAccount', () => {
  it('strips 04, splits branch(3)/account(6), and builds the display form', () => {
    const derived = deriveBancsAccount('04131490974');
    expect(derived).toEqual({ accountNumber: '490974', display: '131-490974' });
  });
});

describe('buildDiscoveryFromEndpoint (BaNCS integration)', () => {
  it('surfaces the derived account as the displayed id while keeping records intact', () => {
    const body = makeYahavBody();
    const endpoint = makeEndpoint(body);
    const result = buildDiscoveryFromEndpoint(endpoint);
    const rawRecords = extractAccountRecords(body);
    expect(result.ids).toEqual(['490974']);
    // The iorId replay handle must remain byte-identical to the raw extract.
    expect(result.records).toEqual(rawRecords);
    expect(result.records[0]?.AccountId).toMatchObject({ iorId: 'n5jvJe' });
  });

  it('leaves a flat-account body byte-identical (18-bank safety)', () => {
    const flatBody = makeFlatBody();
    const endpoint = makeEndpoint(flatBody);
    const result = buildDiscoveryFromEndpoint(endpoint);
    expect(result.ids).toEqual(['12345678']);
  });
});
