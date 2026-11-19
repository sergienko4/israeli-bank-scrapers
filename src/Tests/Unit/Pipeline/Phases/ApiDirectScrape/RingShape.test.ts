/**
 * Ring scrape shape — cards, the GatewayV2 transactions wrapper, the
 * per-call headers, the session-expiry body check and the factory wiring.
 * Built from synthetic ring constants; each issuer instance (Isracard,
 * Amex) is checked once at the end. Bodies are synthetic — zero PII.
 */

import { jest } from '@jest/globals';

import makeRingShape from '../../../../../Scrapers/Pipeline/Banks/_Shared/Ring/RingShape.js';
import {
  accountNumberOf,
  buildExtractCards,
  cardsUrl,
  cardsVars,
  type IRingCard,
} from '../../../../../Scrapers/Pipeline/Banks/_Shared/Ring/RingShapeCards.js';
import { buildRingHeaders } from '../../../../../Scrapers/Pipeline/Banks/_Shared/Ring/RingShapeHeaders.js';
import {
  gatewayUrl,
  txnsExtractPage,
  txnsVars,
} from '../../../../../Scrapers/Pipeline/Banks/_Shared/Ring/RingShapeTxns.js';
import AMEX_SHAPE from '../../../../../Scrapers/Pipeline/Banks/Amex/scrape/AmexShape.js';
import ISRACARD_SHAPE from '../../../../../Scrapers/Pipeline/Banks/Isracard/scrape/IsracardShape.js';
import {
  type ApiBody,
  BALANCE_UNKNOWN,
  type IExtractAccountsArgs,
} from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { none, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';

const CHECK_RING_BODY = ISRACARD_SHAPE.checkBody;
if (CHECK_RING_BODY === undefined) throw new TypeError('Ring shape has no body check');
import type { IActionContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

type RingConstants = Parameters<typeof makeRingShape>[0]['ring'];

const RING: RingConstants = {
  base: 'https://ring.example.test',
  applicationId: 'xx',
  isrdomain: 'example',
  sessionWalletId: '216',
  companyCode: '11',
};

const CARD: IRingCard = { card4Number: '1234', paymentDay: 10, companyCode: 11 };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Wrap a body as extract-accounts args.
 * @param body - Synthetic CardsList body.
 * @returns Extract-accounts args.
 */
function accountsArgs(body: ApiBody): IExtractAccountsArgs {
  return { body, sessionContext: {} };
}

/**
 * Build a CardsList body.
 * @param rows - Table1 rows.
 * @returns CardsList body.
 */
function cardsBody(rows: readonly object[]): ApiBody {
  return { Header: { Status: '1' }, CardsList_102DigitalBean: { Table1: rows } };
}

/**
 * Context with window options and no mediator.
 * @param startDate - Window start.
 * @param futureMonthsToScrape - Future months.
 * @returns Action context.
 */
function ctxWith(startDate: Date, futureMonthsToScrape?: number): IActionContext {
  const options = { startDate, futureMonthsToScrape };
  return { options, apiMediator: none() } as unknown as IActionContext;
}

/**
 * Context whose mediator holds a session context.
 * @param session - Session context (post-login carry snapshot).
 * @returns Action context.
 */
function ctxWithSession(session: Record<string, unknown>): IActionContext {
  const mediator = { getSessionContext: jest.fn((): Record<string, unknown> => session) };
  return { apiMediator: some(mediator) } as unknown as IActionContext;
}

/**
 * Extract cards with the synthetic ring.
 * @param rows - Table1 rows.
 * @returns Ring cards.
 */
function cardsOf(rows: readonly object[]): readonly IRingCard[] {
  const extract = buildExtractCards(RING);
  const body = cardsBody(rows);
  const args = accountsArgs(body);
  return extract(args);
}

describe('ring cards', () => {
  it('maps each Table1 row to its last four digits, debit day and company code', () => {
    const cards = cardsOf([{ cardNumber: '1234', paymentDate: '02', activateInd: '1' }]);
    expect(cards).toEqual([{ card4Number: '1234', paymentDay: 2, companyCode: 11 }]);
  });

  it('coerces a numeric card number and debit day', () => {
    const cards = cardsOf([{ cardNumber: 5678, paymentDate: 10 }]);
    expect(cards).toEqual([{ card4Number: '5678', paymentDay: 10, companyCode: 11 }]);
  });

  it('pads a numeric card number that lost its leading zero', () => {
    const cards = cardsOf([{ cardNumber: 123, paymentDate: '02' }]);
    expect(cards).toEqual([{ card4Number: '0123', paymentDay: 2, companyCode: 11 }]);
  });

  it.each([[''], [null], [undefined], ['12345'], ['12a4'], [12345], [-5]])(
    'yields no cards when one row has card number %p, so the scrape fails loudly',
    cardNumber => {
      const valid = { cardNumber: '1234', paymentDate: '02' };
      const cards = cardsOf([{ cardNumber, paymentDate: '02' }, valid]);
      expect(cards).toEqual([]);
    },
  );

  it.each([[''], ['0'], ['32'], ['x'], [null], [undefined]])(
    'marks debit day %p as unknown',
    paymentDate => {
      const cards = cardsOf([{ cardNumber: '1234', paymentDate }]);
      expect(cards[0].paymentDay).toBe(false);
    },
  );

  it('yields no cards when the bean or its table is missing', () => {
    const extract = buildExtractCards(RING);
    const noBeanArgs = accountsArgs({ Header: { Status: '1' } });
    const nullTableArgs = accountsArgs({ CardsList_102DigitalBean: { Table1: null } });
    const noBean = extract(noBeanArgs);
    const nullTable = extract(nullTableArgs);
    expect(noBean).toEqual([]);
    expect(nullTable).toEqual([]);
  });

  it('requests the card list from the service endpoint', () => {
    const url = cardsUrl(RING);
    const vars = cardsVars();
    expect(url).toBe(
      'https://ring.example.test/service?serviceName=CardsList_102Digital&applicationId=xx',
    );
    expect(vars).toEqual({ walletId: '216', reqName: 'CardsList_102Digital' });
  });

  it('uses the last four digits as the account number', () => {
    const number = accountNumberOf(CARD);
    expect(number).toBe('1234');
  });
});

describe('ring transactions', () => {
  it('wraps the window-start month request in a GatewayV2 envelope', () => {
    const ctx = ctxWith(new Date(2026, 5, 15));
    const vars = txnsVars(CARD, false, ctx);
    expect(vars).toEqual({
      serviceUrl: '11/v3-transactions/v1.1.0/GetTransactionsList',
      Data: {
        card4Number: '1234',
        isNextBillingDate: true,
        cardStatus: 0,
        billingMonth: '01/06/2026',
        companyCode: 11,
        isPartner: false,
      },
    });
  });

  it('keeps the same GatewayV2 route for a card of another company', () => {
    const ctx = ctxWith(new Date(2026, 5, 15));
    const vars = txnsVars({ ...CARD, companyCode: 77 }, false, ctx);
    expect(vars.serviceUrl).toBe('11/v3-transactions/v1.1.0/GetTransactionsList');
    expect(vars.Data).toMatchObject({ companyCode: 77 });
  });

  it('advances the billing month by the cursor offset', () => {
    const ctx = ctxWith(new Date(2026, 5, 15));
    const vars = txnsVars(CARD, 2, ctx);
    expect(vars.Data).toMatchObject({ billingMonth: '01/08/2026', companyCode: 11 });
  });

  it('posts to the issuer GatewayV2 endpoint', () => {
    const url = gatewayUrl(RING);
    expect(url).toBe('https://ring.example.test/GatewayV2');
  });

  it('merges approvals + vouchers and excludes the summary-only current list', () => {
    const vouchers = { israelAbroadVouchersList: [{ id: 'v1' }, { id: 'v2' }] };
    const current = { currentTransactionsBillingMonth: [{ totalTransactionsCurrency: [] }] };
    const approvals = { approvedTransactions: [{ id: 'a1' }] };
    const data = {
      approvals,
      israelAbroadVouchers: { vouchers },
      currentTransactionsList: current,
    };
    const ctx = ctxWith(new Date(2000, 0, 1), 0);
    const page = txnsExtractPage({
      body: { data, isSuccess: true },
      cursor: false,
      acct: CARD,
      ctx,
    });
    expect(page.items).toEqual([{ id: 'a1' }, { id: 'v1' }, { id: 'v2' }]);
    expect(page.nextCursor).toBe(1);
  });

  it('stops when the window is exhausted', () => {
    const ctx = ctxWith(new Date(), 0);
    const page = txnsExtractPage({ body: {}, cursor: false, acct: CARD, ctx });
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBe(false);
  });
});

describe('ring headers', () => {
  it('sends an empty bckey before login or when the carry holds none', () => {
    const headers = buildRingHeaders(RING);
    const noMediator = ctxWith(new Date());
    const noKey = ctxWithSession({ bcKey: 7 });
    const withoutMediator = headers(noMediator);
    const nonString = headers(noKey);
    expect(withoutMediator.BCKey).toBe('');
    expect(nonString.BCKey).toBe('');
  });

  it('sends the static set, the session bcKey and a fresh trace id per call', () => {
    const headers = buildRingHeaders(RING);
    const ctx = ctxWithSession({ bcKey: 'bc-1' });
    const first = headers(ctx);
    const second = headers(ctx);
    expect(first).toMatchObject({
      isrdomain: 'example',
      platform: 'mobile',
      BCKey: 'bc-1',
      'Accept-Encoding': 'identity',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-CLIENT-IP': '0.0.0.0',
    });
    expect(first.TraceIdentifier).toMatch(UUID);
    expect(second.TraceIdentifier).not.toBe(first.TraceIdentifier);
  });
});

describe('ring reply envelope check', () => {
  it.each([['-2'], [-2]])('fails Header.Status %p as an expired session', status => {
    const result = CHECK_RING_BODY({ Header: { Status: status } });
    const isPassed = isOk(result);
    expect(isPassed).toBe(false);
    expect(result).toMatchObject({
      errorType: 'GENERIC',
      errorMessage: 'ring session expired',
      authRejected: true,
    });
  });

  it.each([[{ Header: { Status: '1' } }], [{ Header: { Status: 1 } }], [{ isSuccess: true }]])(
    'passes the confirmed reply %p through',
    body => {
      const result = CHECK_RING_BODY(body);
      expect(result).toEqual({ success: true, value: body });
    },
  );

  it.each([
    [{ Header: { Status: '0' } }],
    [{ Header: { Status: '9876' } }],
    [{ Header: {} }],
    [{ Header: null }],
    [{ isSuccess: false, errorCode: '9' }],
    [{ data: {} }],
  ])('fails the unconfirmed reply %p without echoing its code', body => {
    const result = CHECK_RING_BODY(body);
    expect(result).toMatchObject({
      success: false,
      errorType: 'GENERIC',
      errorMessage: 'ring call refused',
    });
  });

  // The fetch strategy parses any JSON, so a 200 can carry a non-object.
  it.each([[null], [[]], ['ok'], [7]])('fails the non-object reply %p as refused', raw => {
    const body = raw as unknown as ApiBody;
    const result = CHECK_RING_BODY(body);
    expect(result).toMatchObject({
      success: false,
      errorType: 'GENERIC',
      errorMessage: 'ring call refused',
    });
  });
});

describe('ring shape wiring', () => {
  const shape = makeRingShape({
    stepName: 'RingScrape',
    windowNarrowing: 'periodEnumeration',
    ring: RING,
  });

  it('is a card issuer with the session-expiry check', () => {
    expect(shape.stepName).toBe('RingScrape');
    expect(shape.isCardIssuer).toBe(true);
    expect(shape.checkBody).toBe(CHECK_RING_BODY);
  });

  it('posts cards to the service endpoint and months to GatewayV2', () => {
    const cardsEndpoint = cardsUrl(RING);
    expect(shape.customer.urlTag).toBe(cardsEndpoint);
    expect(shape.balance.urlTag).toBe('https://ring.example.test/GatewayV2');
    expect(shape.transactions.urlTag).toBe('https://ring.example.test/GatewayV2');
    expect(shape.customer.method).toBe('POST');
    expect(shape.balance.method).toBe('POST');
    expect(shape.transactions.method).toBe('POST');
  });

  it('publishes no balance when the balance call fails', () => {
    expect(shape.balance.fallbackOnFail).toBe(BALANCE_UNKNOWN);
    expect(shape.balance.skipFetch).toBeUndefined();
  });

  it('declares the out-of-statement container for the coverage audit', () => {
    const specs = shape.transactions.declaredRowSpecs ?? [];
    const paths = specs.map((spec): string => spec.groups);
    expect(paths).toEqual(['data.israelAbroadVouchers.outOfStatementChargeDateVouchers']);
  });

  it('takes the coverage-backfill stance from the brand', () => {
    const windowEndShape = makeRingShape({
      stepName: 'X',
      windowNarrowing: 'windowEnd',
      ring: RING,
    });
    expect(shape.transactions.windowNarrowing).toBe('periodEnumeration');
    expect(windowEndShape.transactions.windowNarrowing).toBe('windowEnd');
  });

  it.each([
    { instance: ISRACARD_SHAPE, step: 'IsracardScrape', origin: 'https://ring.isracard.co.il' },
    { instance: AMEX_SHAPE, step: 'AmexScrape', origin: 'https://ring.americanexpress.co.il' },
  ])(
    'binds $step to its ring host, with the session-expiry check',
    ({ instance, step, origin }) => {
      expect(instance.stepName).toBe(step);
      expect(instance.checkBody).toBe(CHECK_RING_BODY);
      expect(instance.transactions.urlTag).toBe(`${origin}/GatewayV2`);
    },
  );
});
