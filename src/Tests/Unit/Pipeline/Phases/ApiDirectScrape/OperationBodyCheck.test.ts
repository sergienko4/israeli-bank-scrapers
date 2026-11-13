/**
 * Operation-specific body checks are selected before response extraction.
 */

import { jest } from '@jest/globals';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
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

/** A bus with a chosen session warmth and the recovery call it would make. */
interface IRecoveryBus {
  readonly bus: IApiMediator;
  readonly recover: jest.Mock<Promise<Procedure<string>>, []>;
}

/**
 * Answer a re-login as successful.
 * @returns A resolved empty success.
 */
function recoverOk(): Promise<Procedure<string>> {
  const recovered = succeed('');
  return Promise.resolve(recovered);
}

/**
 * The session warmth a bus reports.
 * @param isWarm - Whether a stored session was resumed.
 * @returns The bus's warmth probe.
 */
function warmthOf(isWarm: boolean): () => boolean {
  /**
   * Report the configured warmth.
   * @returns Whether the session is warm.
   */
  function report(): boolean {
    return isWarm;
  }
  return report;
}

/**
 * Build a bus with a chosen session warmth. A warm session qualifies a failed
 * scrape for the recover-once re-login; a cold one never recovers. The spy
 * shows whether a re-login was attempted.
 * @param balance - Balance response body.
 * @param isWarm - Whether a stored session was resumed.
 * @returns The bus and its recovery spy.
 */
function recoveryBusWith(balance: ApiBody, isWarm: boolean): IRecoveryBus {
  const base = busWith(balance);
  const recover = jest.fn<Promise<Procedure<string>>, []>(recoverOk);
  const wasSessionWarm = warmthOf(isWarm);
  const bus: IApiMediator = { ...base, wasSessionWarm, recoverSession: recover };
  return { bus, recover };
}

/**
 * A body check that throws instead of answering.
 * @param thrown - The value to throw.
 * @returns A throwing check.
 */
function throwingCheck(thrown: unknown): BodyCheck {
  /**
   * Throw instead of answering.
   * @returns Never.
   */
  function checkThatThrows(): Procedure<ApiBody> {
    throw thrown;
  }
  return checkThatThrows;
}

/**
 * A body check that refuses the customer response.
 * @returns A typed refusal.
 */
function refuseCustomer(): Procedure<ApiBody> {
  return fail(ScraperErrorTypes.Generic, 'invalid customer');
}

/**
 * Declare the check as the operation check of the customer call.
 * @param check - The check under test.
 * @returns Shape under test.
 */
function onCustomerOperation(check: BodyCheck): typeof SYN_CASE.shape {
  return { ...SYN_CASE.shape, checkBodyByOperation: { customer: check } };
}

/**
 * Declare the check as the global check.
 * @param check - The check under test.
 * @returns Shape under test.
 */
function onGlobalCheck(check: BodyCheck): typeof SYN_CASE.shape {
  return { ...SYN_CASE.shape, checkBody: check };
}

/**
 * Declare the check as the operation check of the secondary identity call.
 * @param check - The check under test.
 * @returns Shape under test.
 */
function onSecondaryIdentity(check: BodyCheck): typeof SYN_CASE.shape {
  const customer = { ...SYN_CASE.shape.customer, secondaryUrlTag: SECONDARY_URL };
  const checkBodyByOperation = { 'customer-secondary': check };
  return { ...SYN_CASE.shape, bootstrap: BOOTSTRAP, customer, checkBodyByOperation };
}

const CHECK_FAILURE = new Error('check exploded');
const PLACEMENTS = [
  { name: 'an operation check', place: onCustomerOperation, callback: 'checkBodyByOperation' },
  { name: 'the global check', place: onGlobalCheck, callback: 'checkBody' },
  {
    name: 'the secondary identity check',
    place: onSecondaryIdentity,
    callback: 'checkBodyByOperation',
  },
];
const NON_ERROR_THROWS = [
  { name: 'a string', thrown: 'check exploded as text' },
  { name: 'a Symbol', thrown: Symbol('check exploded') },
];

/**
 * An error whose message quotes the bank's answer and whose class name is
 * chosen by the thrower, as a hostile or careless callback might produce.
 * @returns The error.
 */
function leakyError(): Error {
  const leaky = new Error('bank account text in the body');
  leaky.name = 'LEAKED-CLASS-NAME';
  return leaky;
}

/**
 * The typed failure a throwing callback is converted to.
 * @param callback - The callback that threw.
 * @returns The failure message the scrape reports.
 */
function threwMessage(callback: string): string {
  return `shape ${callback} threw: Error`;
}

/**
 * An object whose `name` getter throws when read.
 * @returns The hostile value.
 */
function throwingNameGetter(): object {
  const hostile = {};
  Object.defineProperty(hostile, 'name', {
    /**
     * Throw instead of answering.
     * @returns Never.
     */
    get(): never {
      throw new ScraperError('name getter exploded');
    },
  });
  return hostile;
}

/**
 * A frozen object with no prototype, so nothing can be inherited or coerced.
 * @returns The hostile value.
 */
function frozenBareObject(): object {
  const bare = Object.create(null) as object;
  return Object.freeze(bare);
}

const HOSTILE_THROWS = [
  { name: 'an object whose name getter throws', make: throwingNameGetter },
  { name: 'a frozen null-prototype object', make: frozenBareObject },
];

describe('body check that throws', () => {
  it('[BCT-0] recovers a typed refusal once on a warm session (control)', async () => {
    const { bus, recover } = recoveryBusWith(SYN_CASE.fixtures.balance, true);
    const shape = onCustomerOperation(refuseCustomer);
    const result = await runShape(shape, bus);
    expect(result.success).toBe(false);
    expect(recover).toHaveBeenCalledTimes(1);
  });

  it.each(PLACEMENTS)('[BCT-1] recovers once on a warm session when $name throws', async row => {
    const { bus, recover } = recoveryBusWith(SYN_CASE.fixtures.balance, true);
    const check = throwingCheck(CHECK_FAILURE);
    const shape = row.place(check);
    await runShape(shape, bus);
    expect(recover).toHaveBeenCalledTimes(1);
  });

  it.each(PLACEMENTS)(
    '[BCT-2] fails typed, without recovery, when $name throws cold',
    async row => {
      const { bus, recover } = recoveryBusWith(SYN_CASE.fixtures.balance, false);
      const check = throwingCheck(CHECK_FAILURE);
      const shape = row.place(check);
      const result = await runShape(shape, bus);
      expect(result).toMatchObject({ success: false, errorMessage: threwMessage(row.callback) });
      expect(recover).not.toHaveBeenCalled();
    },
  );

  it.each(NON_ERROR_THROWS)('[BCT-3] fails typed when $name is thrown by a check', async row => {
    const { bus } = recoveryBusWith(SYN_CASE.fixtures.balance, false);
    const check = throwingCheck(row.thrown);
    const shape = onGlobalCheck(check);
    const result = await runShape(shape, bus);
    expect(result).toMatchObject({ success: false, errorMessage: threwMessage('checkBody') });
  });

  it('[BCT-4] never reports the thrown message or a thrown class name', async () => {
    const { bus } = recoveryBusWith(SYN_CASE.fixtures.balance, false);
    const leaky = leakyError();
    const check = throwingCheck(leaky);
    const shape = onGlobalCheck(check);
    const result = await runShape(shape, bus);
    expect(result).toMatchObject({ success: false, errorMessage: threwMessage('checkBody') });
  });

  it.each(HOSTILE_THROWS)('[BCT-6] fails typed when a check throws $name', async row => {
    const { bus } = recoveryBusWith(SYN_CASE.fixtures.balance, false);
    const thrown = row.make();
    const check = throwingCheck(thrown);
    const shape = onGlobalCheck(check);
    const result = await runShape(shape, bus);
    expect(result).toMatchObject({ success: false, errorMessage: threwMessage('checkBody') });
  });

  it('[BCT-5] does not run the global check after an operation check throws', async () => {
    const seen: string[] = [];
    const throwing = throwingCheck(CHECK_FAILURE);
    const checkBodyByOperation = { customer: throwing };
    const checkBody = recordingCheck('global', seen);
    const shape = { ...SYN_CASE.shape, checkBodyByOperation, checkBody };
    const { bus } = recoveryBusWith(SYN_CASE.fixtures.balance, false);
    const result = await runShape(shape, bus);
    expect(result.success).toBe(false);
    expect(seen).toEqual([]);
  });
});
