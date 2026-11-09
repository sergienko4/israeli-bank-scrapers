/**
 * Operation-specific body checks are selected before response extraction.
 */

import { jest } from '@jest/globals';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import type { IApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import { dispatchStep } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapeDispatch.js';
import {
  type ApiDirectScrapeResult,
  createApiDirectScrapePhase,
} from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapePhase.js';
import type {
  ApiBody,
  BodyCheck,
} from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { literalUrl } from '../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { none, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { IActionContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';
import { SYN_CASE } from './ApiDirectScrapeBankShapes.js';
import { makeRouterBus } from './ApiDirectScrapeRouterBus.js';

const BOOTSTRAP_URL = literalUrl('https://bank.example/bootstrap');
const SECONDARY_URL = literalUrl('https://bank.example/customer-secondary');

/**
 * Records a body check and passes its input through unchanged.
 * @param name - Operation name.
 * @param seen - Ordered check names.
 * @returns Body check.
 */
function recordingCheck(name: string, seen: string[]): BodyCheck {
  return (body): Procedure<ApiBody> => {
    seen.push(name);
    return succeed(body);
  };
}

/**
 * Refuses a response without a numeric balance.
 * @param body - Response for the balance operation.
 * @returns The valid response or a failure.
 */
function checkBalanceBody(body: ApiBody): Procedure<ApiBody> {
  if (typeof body.balance === 'number') return succeed(body);
  return fail(ScraperErrorTypes.Generic, 'invalid balance body');
}

/**
 * Answers bootstrap, secondary, customer and financial calls.
 * @param balance - Balance response body.
 * @returns Router-backed mediator.
 */
function busWith(balance: ApiBody): IApiMediator {
  const { customer, transactions } = SYN_CASE.fixtures;
  const bus = makeRouterBus({
    [BOOTSTRAP_URL]: [succeed({ ready: true })],
    [SECONDARY_URL]: [succeed({ identity: true })],
    customer: [succeed(customer)],
    balance: [succeed(balance)],
    transactions: [succeed(transactions)],
  });
  /**
   * Routes secondary GETs through the shared response queues.
   * @param url - Requested URL.
   * @param opts - Request options.
   * @returns Queued response.
   */
  const apiGet: IApiMediator['apiGet'] = (url, opts) => bus.apiPost(url, {}, opts);
  return { ...bus, apiGet };
}

/**
 * Runs a synthetic scrape using the shared phase and mediator.
 * @param shape - Shape under test.
 * @param bus - Router-backed mediator.
 * @returns Scrape result.
 */
function runShape(
  shape: typeof SYN_CASE.shape,
  bus: IApiMediator,
): Promise<Procedure<ApiDirectScrapeResult>> {
  const base = makeMockContext({ apiMediator: some(bus) });
  const ctx: IActionContext = { ...base, windowEnd: none() };
  const run = createApiDirectScrapePhase(shape);
  return run(ctx);
}

const BOOTSTRAP = {
  urlTag: BOOTSTRAP_URL,
  /**
   * Builds a bootstrap without variables.
   * @returns Empty request variables.
   */
  buildVars: (): Record<string, never> => ({}),
  /**
   * Keeps the existing session unchanged.
   * @returns Empty session patch.
   */
  extractPatch: (): Procedure<Record<string, never>> => succeed({}),
};

describe('operation-specific body checks', () => {
  it('selects each operation check before the global check', async () => {
    const seen: string[] = [];
    const checkBodyByOperation = {
      bootstrap: recordingCheck('bootstrap', seen),
      customer: recordingCheck('customer', seen),
      'customer-secondary': recordingCheck('customer-secondary', seen),
      balance: recordingCheck('balance', seen),
      txns: recordingCheck('txns', seen),
    };
    const customer = { ...SYN_CASE.shape.customer, secondaryUrlTag: SECONDARY_URL };
    const shape = {
      ...SYN_CASE.shape,
      bootstrap: BOOTSTRAP,
      customer,
      checkBodyByOperation,
      checkBody: recordingCheck('global', seen),
    };
    const bus = busWith(SYN_CASE.fixtures.balance);
    const result = await runShape(shape, bus);
    expect(result.success).toBe(true);
    expect(seen).toEqual([
      'bootstrap',
      'global',
      'customer',
      'global',
      'customer-secondary',
      'global',
      'balance',
      'global',
      'txns',
      'global',
    ]);
  });

  it('rejects an accounts body returned to balance before extraction', async () => {
    const extract = jest.fn((): number => 0);
    const balance = { ...SYN_CASE.shape.balance, extract };
    const checkBodyByOperation = { balance: checkBalanceBody };
    const shape = { ...SYN_CASE.shape, balance, checkBodyByOperation };
    const bus = busWith(SYN_CASE.fixtures.customer);
    const result = await runShape(shape, bus);
    expect(result).toMatchObject({ success: false, errorMessage: 'invalid balance body' });
    expect(extract).not.toHaveBeenCalled();
  });

  it('passes a valid balance to its extractor', async () => {
    const extract = jest.fn((): number => 42);
    const balance = { ...SYN_CASE.shape.balance, extract };
    const checkBodyByOperation = { balance: checkBalanceBody };
    const shape = { ...SYN_CASE.shape, balance, checkBodyByOperation };
    const bus = busWith(SYN_CASE.fixtures.balance);
    const result = await runShape(shape, bus);
    expect(result.success).toBe(true);
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it('does not run the global check after an operation check refuses a body', async () => {
    const seen: string[] = [];
    const checkBodyByOperation = {
      /**
       * Refuses a mismatched customer response.
       * @returns The refusal.
       */
      customer: (): Procedure<ApiBody> => fail(ScraperErrorTypes.Generic, 'invalid customer'),
    };
    const shape = {
      ...SYN_CASE.shape,
      checkBodyByOperation,
      checkBody: recordingCheck('global', seen),
    };
    const bus = busWith(SYN_CASE.fixtures.balance);
    const result = await runShape(shape, bus);
    expect(result).toMatchObject({ success: false, errorMessage: 'invalid customer' });
    expect(seen).toEqual([]);
  });

  it('passes the operation-checked body to the global check', async () => {
    const seen: unknown[] = [];
    /**
     * Records the marker on checked balance bodies.
     * @param body - Checked response.
     * @returns Unchanged response.
     */
    const checkBody: BodyCheck = body => {
      if (Object.hasOwn(body, 'balance')) seen.push(body.validated);
      return succeed(body);
    };
    const checkBodyByOperation = {
      /**
       * Adds a marker before the global check.
       * @param body - Balance response.
       * @returns Response with the marker.
       */
      balance: (body: ApiBody): Procedure<ApiBody> => succeed({ ...body, validated: true }),
    };
    const shape = { ...SYN_CASE.shape, checkBodyByOperation, checkBody };
    const bus = busWith(SYN_CASE.fixtures.balance);
    const result = await runShape(shape, bus);
    expect(result.success).toBe(true);
    expect(seen).toEqual([true]);
  });

  it('refuses a dispatch with operation checks but no operation before IO', async () => {
    const bus = busWith(SYN_CASE.fixtures.balance);
    const base = makeMockContext({ apiMediator: some(bus) });
    const ctx: IActionContext = { ...base, windowEnd: none() };
    const args = {
      bus,
      ctx,
      queryTag: 'customer' as const,
      urlTag: false as const,
      method: 'POST' as const,
      vars: {},
      bodyTemplate: false as const,
      signer: false as const,
      opts: {},
      checkBodyByOperation: { customer: recordingCheck('customer', []) },
    };
    const result = await dispatchStep(args);
    expect(result).toMatchObject({
      success: false,
      errorMessage: 'scrape operation required for body checks',
    });
    expect(bus.apiQuery).not.toHaveBeenCalled();
  });

  it('keeps global checks for a shape without operation checks', async () => {
    const seen: string[] = [];
    const shape = { ...SYN_CASE.shape, checkBody: recordingCheck('global', seen) };
    const bus = busWith(SYN_CASE.fixtures.balance);
    const result = await runShape(shape, bus);
    expect(result.success).toBe(true);
    expect(seen).toEqual(['global', 'global', 'global']);
  });

  it('passes a failed transport response through without running either check', async () => {
    const seen: string[] = [];
    const checkBodyByOperation = { customer: recordingCheck('customer', seen) };
    const shape = {
      ...SYN_CASE.shape,
      checkBodyByOperation,
      checkBody: recordingCheck('global', seen),
    };
    const failure = fail(ScraperErrorTypes.NetworkError, 'network unavailable');
    const bus = makeRouterBus({ customer: [failure] });
    const result = await runShape(shape, bus);
    expect(result).toBe(failure);
    expect(seen).toEqual([]);
  });
});
