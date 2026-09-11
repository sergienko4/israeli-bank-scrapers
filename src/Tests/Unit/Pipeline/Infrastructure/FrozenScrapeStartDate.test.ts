/**
 * Frozen scrape context date-boundary regression.
 */

import { jest } from '@jest/globals';
import moment from 'moment-timezone';

import type { IFetchAllAccountsCtx } from '../../../../Scrapers/Pipeline/Strategy/Scrape/ScrapeTypes.js';
import { some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IApiFetchContext,
  IScrapeDiscovery,
} from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { ITransactionsAccount } from '../../../../Transactions.js';
import { captureAmbientZone, restoreAmbientZone } from '../../../Helpers/AmbientZone.js';

let capturedStartDate = '';

/** Capture the production context without entering an account strategy. */
const SCRAPE_ALL_ACCOUNTS = jest.fn(
  (ctx: IFetchAllAccountsCtx): Promise<readonly ITransactionsAccount[]> => {
    capturedStartDate = ctx.fc.startDate;
    return Promise.resolve([]);
  },
);

jest.unstable_mockModule(
  '../../../../Scrapers/Pipeline/Strategy/Scrape/Account/ScrapeDispatch.js',
  () => ({ scrapeAllAccounts: SCRAPE_ALL_ACCOUNTS }),
);

const ACTION = await import('../../../../Scrapers/Pipeline/Mediator/Scrape/FrozenScrapeAction.js');
const FACTORIES = await import('../../Scrapers/Pipeline/MockPipelineFactories.js');
const HELPERS = await import('./TestHelpers.js');

/**
 * Build an inert API context for the frozen path.
 * @returns API context whose behavior is not reached by an empty account list.
 */
function makeApi(): IApiFetchContext {
  return {} as IApiFetchContext;
}

/**
 * Build the smallest discovery that passes the frozen-path guard.
 * @returns Discovery with one inert frozen endpoint.
 */
function makeDiscovery(): IScrapeDiscovery {
  return {
    qualifiedCards: [],
    prunedCards: [],
    txnTemplateUrl: '',
    txnTemplateBody: {},
    billingMonths: [],
    frozenEndpoints: [
      {
        url: 'https://bank.example.com/accounts',
        method: 'GET',
        postData: '',
        responseBody: {},
        contentType: 'application/json',
        requestHeaders: {},
        responseHeaders: {},
        timestamp: 0,
      },
    ],
  };
}

describe('executeFrozenDirectScrape startDate', () => {
  it('FROZEN-START-DATE-001 — renders the caller instant in the bank calendar', async () => {
    const api = makeApi();
    const discovery = makeDiscovery();
    const base = FACTORIES.makeMockContext({
      api: some(api),
      scrapeDiscovery: some(discovery),
    });
    const options = { ...base.options, startDate: new Date('2026-03-01T21:30:00.000Z') };
    const executor = HELPERS.makeMockActionExecutor();
    const input = HELPERS.toActionCtx({ ...base, options }, executor);
    const previous = captureAmbientZone();
    moment.tz.setDefault('Pacific/Kiritimati');
    try {
      const result = ACTION.executeFrozenDirectScrape(input);
      await result;
      expect(capturedStartDate).toBe('20260301');
    } finally {
      restoreAmbientZone(previous);
    }
  });
});
