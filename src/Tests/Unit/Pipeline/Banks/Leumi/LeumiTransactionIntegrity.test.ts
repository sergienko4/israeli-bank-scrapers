import { LEUMI_SHAPE } from '../../../../../Scrapers/Pipeline/Banks/Leumi/scrape/LeumiShape.js';
import { leumiBrokerUrl } from '../../../../../Scrapers/Pipeline/Banks/Leumi/scrape/LeumiShapeEnvelope.js';
import { GET_ACCOUNTS_MODULE } from '../../../../../Scrapers/Pipeline/Banks/Leumi/scrape/LeumiShapeHelpers.js';
import { UC_SO_27_MODULE } from '../../../../../Scrapers/Pipeline/Banks/Leumi/scrape/LeumiShapeUcSo27.js';
import { createApiDirectScrapePhase } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapePhase.js';
import { none, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { IActionContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { assertHas, assertOk } from '../../../../Helpers/AssertProcedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';
import { makeRouterBus } from '../../Phases/ApiDirectScrape/ApiDirectScrapeRouterBus.js';

const ROW = { DateUTC: '2026-03-01', Amount: 10, FITID: 'synthetic-id' };

/**
 * Wraps the synthetic response in a WCF envelope.
 * @param inner - Synthetic WCF response.
 * @returns A wrapped response.
 */
function envelope(inner: object): Record<string, unknown> {
  return { ProcessRequestResult: 0, jsonResp: JSON.stringify(inner) };
}

/**
 * Builds an isolated scrape context for one transaction.
 * @param row - Synthetic transaction.
 * @returns A context using queued synthetic responses.
 */
function transactionContext(row: object): IActionContext {
  const accounts = envelope({ AccountsItems: [{ AccountIndex: 0, MaskedNumber: 'sample' }] });
  const balance = envelope({ SOStatus: { Status: true }, BalanceDisplay: 7 });
  const page = envelope({ SOStatus: { Status: true }, HistoryTransactionsItems: [row] });
  const bus = makeRouterBus({
    [leumiBrokerUrl(GET_ACCOUNTS_MODULE)]: [succeed(accounts)],
    [leumiBrokerUrl(UC_SO_27_MODULE)]: [succeed(balance), succeed(page), succeed(page)],
  });
  const base = makeMockContext({ apiMediator: some(bus) });
  return {
    ...base,
    options: { ...base.options, startDate: new Date('2026-03-01T00:00:00Z') },
    windowEnd: none(),
  };
}

describe('Leumi transaction source integrity', () => {
  it.each([
    ['a conflicting earlier date alias', { ...ROW, purchaseDate: '2026-02-01' }],
    ['an invalid calendar date', { ...ROW, DateUTC: '2026-02-31' }],
    ['a year without a day', { ...ROW, DateUTC: '2026' }],
    ['a month without a day', { ...ROW, DateUTC: '2026-03' }],
    ['a placeholder date with a timezone', { ...ROW, DateUTC: '0001-01-01T00:00:00Z' }],
    ['a missing source date', { ...ROW, DateUTC: undefined, purchaseDate: ROW.DateUTC }],
    ['a missing identifier', { ...ROW, FITID: undefined }],
    ['a blank identifier without fallback', { ...ROW, FITID: ' ' }],
    ['a control-only identifier', { ...ROW, FITID: '\u0000' }],
    ['a control-only fallback', { ...ROW, FITID: undefined, ReferenceNumberLong: '\u0001' }],
    ['a conflicting identifier alias', { ...ROW, OperationNumber: 42 }],
    ['a nested identifier without a root identifier', { ...ROW, FITID: undefined, aux: { id: 8 } }],
  ])('refuses %s before returning financial data', async (_label, row) => {
    const ctx = transactionContext(row);
    const run = createApiDirectScrapePhase(LEUMI_SHAPE);
    const outcome = await run(ctx);
    expect(outcome).toMatchObject({
      success: false,
      errorMessage: 'Leumi transactions WCF response failed validation',
    });
  });

  it.each(['', ' ', '0', 0, '\u0000', 'id\u0000'])(
    'uses the root fallback when FITID is unusable (%s)',
    async primary => {
      const row = { ...ROW, FITID: primary, ReferenceNumberLong: 781 };
      const ctx = transactionContext(row);
      const run = createApiDirectScrapePhase(LEUMI_SHAPE);
      const outcome = await run(ctx);
      assertOk(outcome);
      assertHas(outcome.value.scrape);
      expect(outcome.value.scrape.value.accounts[0].txns).toMatchObject([
        { identifier: 781, chargedAmount: 10 },
      ]);
    },
  );

  it('preserves the FITID when the fallback also exists', async () => {
    const row = { ...ROW, ReferenceNumberLong: 781 };
    const ctx = transactionContext(row);
    const run = createApiDirectScrapePhase(LEUMI_SHAPE);
    const outcome = await run(ctx);
    assertOk(outcome);
    assertHas(outcome.value.scrape);
    expect(outcome.value.scrape.value.accounts[0].txns).toMatchObject([
      { identifier: 'synthetic-id', chargedAmount: 10 },
    ]);
  });

  it.each(['20260301', '2026-03-01T00:00:00Z'])(
    'accepts a complete source date (%s)',
    async date => {
      const ctx = transactionContext({ ...ROW, DateUTC: date });
      const run = createApiDirectScrapePhase(LEUMI_SHAPE);
      const outcome = await run(ctx);
      assertOk(outcome);
      assertHas(outcome.value.scrape);
      expect(outcome.value.scrape.value.accounts[0].txns).toMatchObject([
        { identifier: 'synthetic-id', chargedAmount: 10 },
      ]);
    },
  );

  it.each([
    ['2026-03-01T00:00:00.000', '2026-02-28T22:00:00.000Z'],
    ['20260301T000000Z', '2026-03-01T00:00:00.000Z'],
    ['2026-03-01T04:30:00+02:00', '2026-03-01T02:30:00.000Z'],
  ])('returns an unambiguous UTC instant for %s', async (date, expected) => {
    const ctx = transactionContext({ ...ROW, DateUTC: date });
    const outcome = await createApiDirectScrapePhase(LEUMI_SHAPE)(ctx);
    assertOk(outcome);
    assertHas(outcome.value.scrape);
    expect(outcome.value.scrape.value.accounts[0].txns).toMatchObject([{ date: expected }]);
  });

  it('normalizes an equal higher-priority date alias too', async () => {
    const date = '2026-03-01T00:00:00.000';
    const ctx = transactionContext({ ...ROW, DateUTC: date, purchaseDate: date });
    const outcome = await createApiDirectScrapePhase(LEUMI_SHAPE)(ctx);
    assertOk(outcome);
    assertHas(outcome.value.scrape);
    expect(outcome.value.scrape.value.accounts[0].txns).toMatchObject([
      { date: '2026-02-28T22:00:00.000Z' },
    ]);
  });
});
