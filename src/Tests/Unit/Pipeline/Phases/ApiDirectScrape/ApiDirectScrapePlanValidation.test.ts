import { jest } from '@jest/globals';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import type { IApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import { makeEvidenceLedger } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/CoverageAudit/EvidenceLedger.js';
import collectAccountRows from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapeBackfill.js';
import type { IAcctCtx } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapeDispatchArgs.js';
import type { IApiDirectScrapeShape } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { none, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IActionContext,
  IPipelineContext,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, isOk, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext, makeRecoverySessionStubs } from '../../Infrastructure/MockFactories.js';

/** Synthetic account carried by the plan-validation shape. */
interface IAcct {
  readonly id: string;
}

/**
 * Reject every request plan before it can reach the provider.
 * @returns Typed synthetic plan failure.
 */
function rejectPlan(): Procedure<void> {
  return fail(ScraperErrorTypes.Generic, 'request plan exceeds its budget');
}

/**
 * Extract an exhausted empty page if a request incorrectly reaches the bus.
 * @returns Empty terminal page.
 */
function extractPage(): { items: readonly object[]; nextCursor: false } {
  return { items: [], nextCursor: false };
}

/**
 * Resolve the synthetic account identifier.
 * @param acct - Account under test.
 * @returns Its stable identifier.
 */
function accountNumberOf(acct: IAcct): string {
  return acct.id;
}

/**
 * Build an empty request-variable bundle.
 * @returns Empty variables.
 */
function noVars(): object {
  return {};
}

/**
 * Extract no accounts for the unused customer step.
 * @returns Empty account list.
 */
function noAccounts(): IAcct[] {
  return [];
}

/**
 * Resolve the unused balance step.
 * @returns Zero.
 */
function noBalance(): number {
  return 0;
}

/** Shape whose transaction plan always fails validation. */
const SHAPE = {
  stepName: 'RejectedPlanShape',
  accountNumberOf,
  customer: { buildVars: noVars, extractAccounts: noAccounts },
  balance: { buildVars: noVars, extract: noBalance },
  transactions: {
    buildVars: noVars,
    extractPage,
    validatePlan: rejectPlan,
    windowNarrowing: 'none',
  },
} as unknown as IApiDirectScrapeShape<IAcct, string>;

/**
 * Build a mediator that records any forbidden transaction request.
 * @param seen - Request markers appended in call order.
 * @returns Recording fake mediator.
 */
function makeBus(seen: string[]): IApiMediator {
  const apiQuery = jest.fn(async (): Promise<Procedure<unknown>> => {
    await Promise.resolve();
    seen.push('transactions');
    return succeed({});
  });
  const base = { apiPost: jest.fn(), apiGet: jest.fn(), apiQuery };
  const stubs = makeRecoverySessionStubs();
  return {
    ...base,
    ...stubs,
    setBearer: jest.fn(),
    setRawAuth: jest.fn(),
  } as unknown as IApiMediator;
}

/**
 * Build one account collection context for the rejecting shape.
 * @param bus - Recording fake mediator.
 * @returns Per-account driver context.
 */
function accountContext(bus: IApiMediator): IAcctCtx<IAcct, string> {
  const options = { startDate: new Date('2026-01-01T00:00:00Z') };
  const base = makeMockContext({ apiMediator: some(bus), options } as Partial<IPipelineContext>);
  const ctx = { ...base, windowEnd: none() } as unknown as IActionContext;
  return { shape: SHAPE, bus, ctx, acct: { id: 'acct-1' }, ledger: makeEvidenceLedger() };
}

describe('collectAccountRows — request-plan validation', () => {
  it('fails before the first provider request when the plan is rejected', async () => {
    const seen: string[] = [];
    const bus = makeBus(seen);
    const ctx = accountContext(bus);
    const result = await collectAccountRows(ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(false);
    expect(seen).toHaveLength(0);
  });
});
