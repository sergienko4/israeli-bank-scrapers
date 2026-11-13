/**
 * Callbacks that stay outside the guarded boundary, by decision.
 *
 * <p>`auditOwnsRow`, `auditIsTxnRow` and `resultGuard` read a response only to
 * observe it: the coverage audit counts rows and the result guard reads counters.
 * A throw from one is a defect in the shape, not an unusable answer, so it is not
 * converted to a typed failure and does not qualify the scrape for recovery. The
 * executor's catch is the only thing left to contain it.
 *
 * <p>Each case has a control that proves the callback is reached, so a throw that
 * is never invoked cannot read as a pass.
 */

import { jest } from '@jest/globals';

import type { IApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import {
  type ApiDirectScrapeResult,
  buildApiDirectScrapePhase,
  createApiDirectScrapePhase,
} from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapePhase.js';
import type { IApiDirectScrapeShape } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { none, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { IScrapeState } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';
import { SYN_CASE } from './ApiDirectScrapeBankShapes.js';
import { makeRouterBus } from './ApiDirectScrapeRouterBus.js';

type SynShape = typeof SYN_CASE.shape;

const ROW = { purchaseDate: '2026-06-02', businessName: 'Corner Cafe', billingAmount: 12 };
const PAGE = { items: [ROW], nextCursor: false };
const AUDIT_FAILURE = new Error('audit predicate exploded');
const GUARD_FAILURE = new Error('result guard exploded');

/**
 * Answer a re-login as successful.
 * @returns A resolved empty success.
 */
function recoverOk(): Promise<Procedure<string>> {
  const recovered = succeed('');
  return Promise.resolve(recovered);
}

/**
 * Report the session as warm, so any failed scrape would qualify for recovery.
 * @returns Always true.
 */
function reportWarm(): boolean {
  return true;
}

/** A warm bus serving one recognizable transaction row, and its recovery spy. */
interface IWarmBus {
  readonly bus: IApiMediator;
  readonly recover: jest.Mock<Promise<Procedure<string>>, []>;
}

/**
 * Build a warm bus whose transactions answer carries one recognizable row.
 * @returns The bus and its recovery spy.
 */
function warmBusWithRow(): IWarmBus {
  const { customer, balance } = SYN_CASE.fixtures;
  const router = { customer: [succeed(customer)], balance: [succeed(balance)] };
  const bus = makeRouterBus({ ...router, transactions: [succeed(PAGE), succeed(PAGE)] });
  const recover = jest.fn<Promise<Procedure<string>>, []>(recoverOk);
  Object.assign(bus, { wasSessionWarm: reportWarm, recoverSession: recover });
  return { bus, recover };
}

/**
 * Run the scrape over a bus.
 * @param bus - Router-backed mediator.
 * @param shape - Shape under test.
 * @returns The scrape outcome.
 */
function scrapeWith(bus: IApiMediator, shape: SynShape): Promise<Procedure<ApiDirectScrapeResult>> {
  const base = makeMockContext({ apiMediator: some(bus) });
  const ctx = { ...base, windowEnd: none() };
  const scrape = createApiDirectScrapePhase(shape);
  return scrape(ctx);
}

/**
 * A predicate that throws instead of answering.
 * @returns Never.
 */
function throwAudit(): boolean {
  throw AUDIT_FAILURE;
}

/**
 * Declare an audit callback on the transactions step.
 * @param callbacks - The audit callbacks to declare.
 * @returns Shape under test.
 */
function withAudit(callbacks: Partial<SynShape['transactions']>): SynShape {
  return { ...SYN_CASE.shape, transactions: { ...SYN_CASE.shape.transactions, ...callbacks } };
}

describe('audit callbacks stay outside the guarded boundary', () => {
  it.each(['auditOwnsRow', 'auditIsTxnRow'] as const)(
    '[UGC-1] reaches %s on a recognizable row (control)',
    async name => {
      const spy = jest.fn((): boolean => true);
      const { bus } = warmBusWithRow();
      const shape = withAudit({ [name]: spy });
      await scrapeWith(bus, shape);
      expect(spy).toHaveBeenCalled();
    },
  );

  it.each(['auditOwnsRow', 'auditIsTxnRow'] as const)(
    '[UGC-2] rejects the scrape and skips recovery when %s throws',
    async name => {
      const { bus, recover } = warmBusWithRow();
      const shape = withAudit({ [name]: throwAudit });
      const pending = scrapeWith(bus, shape);
      await expect(pending).rejects.toBe(AUDIT_FAILURE);
      expect(recover).not.toHaveBeenCalled();
    },
  );
});

/**
 * A guard that throws instead of answering.
 * @returns Never.
 */
function throwGuard(): never {
  throw GUARD_FAILURE;
}

/**
 * One account with one transaction, so the zero-accounts floor passes.
 * @returns The scrape state the POST stage reads.
 */
function populatedScrape(): IScrapeState {
  const account = { accountNumber: 'syn-num-1', txns: [ROW], balance: 42 };
  return { accounts: [account], balanceDegraded: false } as unknown as IScrapeState;
}

/**
 * Build the phase with a declared result guard.
 * @param guard - The guard to declare.
 * @returns The phase.
 */
function phaseWithGuard(guard: () => unknown): ReturnType<typeof buildApiDirectScrapePhase> {
  const shape = { ...SYN_CASE.shape, resultGuard: guard };
  return buildApiDirectScrapePhase(shape as unknown as IApiDirectScrapeShape<unknown, unknown>);
}

describe('resultGuard stays outside the guarded boundary', () => {
  it('[UGC-3] reaches the declared guard once accounts exist (control)', async () => {
    const guard = jest.fn(() => succeed(undefined));
    const phase = phaseWithGuard(guard);
    const state = populatedScrape();
    const scrape = some(state);
    const input = makeMockContext({ scrape });
    await phase.post(input, input);
    expect(guard).toHaveBeenCalledTimes(1);
  });

  it('[UGC-4] throws out of the POST stage when the guard throws', () => {
    const phase = phaseWithGuard(throwGuard);
    const state = populatedScrape();
    const scrape = some(state);
    const input = makeMockContext({ scrape });
    expect(() => phase.post(input, input)).toThrow(GUARD_FAILURE);
  });
});
