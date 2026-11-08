/**
 * Loss evidence survives the real account walk and reaches the result guard.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import type { IApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import {
  buildApiDirectScrapePhase,
  createApiDirectScrapePhase,
} from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapePhase.js';
import type { IApiDirectScrapeGuardSummary } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { none, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IActionContext,
  IPipelineContext,
  IScrapeState,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import type { WindowCaveat } from '../../../../../WindowCoverage.js';
import { assertHas, assertOk } from '../../../../Helpers/AssertProcedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';
import { SYN_CASE } from './ApiDirectScrapeBankShapes.js';
import { makeRouterBus } from './ApiDirectScrapeRouterBus.js';

const START = new Date('2026-01-01T00:00:00Z');
const LOSS_CHANNELS: readonly WindowCaveat[] = [
  'declaredRowShortfall',
  'extractionShortfall',
  'mappingRejectedRows',
];

/**
 * Applies the strict loss policy to the evidence offered by the phase.
 * @param summary - PII-free result-guard input.
 * @returns A failure for missing evidence or observed loss.
 */
function strictGuard(summary: IApiDirectScrapeGuardSummary): Procedure<void> {
  const caveats = summary.observedCaveats;
  if (caveats === undefined) return fail(ScraperErrorTypes.Generic, 'evidence unavailable');
  if (LOSS_CHANNELS.some(caveat => caveats.includes(caveat))) {
    return fail(ScraperErrorTypes.Generic, 'observed row loss');
  }
  return succeed(undefined);
}

/**
 * Makes a synthetic transaction recognizable by the real mapper and audit.
 * @param date - Provider transaction date.
 * @param merchant - Synthetic merchant label.
 * @returns Provider-shaped row.
 */
function row(date: string, merchant: string): object {
  return { purchaseDate: date, businessName: merchant, billingAmount: 10 };
}

/**
 * Makes a page that triggers one chosen evidence channel.
 * @param caveat - Loss channel, or clean for a page without loss.
 * @param date - Date of the valid extracted row.
 * @returns Synthetic provider response.
 */
function page(caveat: WindowCaveat | 'clean', date: string): Record<string, unknown> {
  const good = row(date, 'market');
  const bad = caveat === 'mappingRejectedRows' ? [row('invalid-date', 'bakery')] : [];
  const unread = caveat === 'extractionShortfall' ? [row(date, 'cafe')] : [];
  const count = caveat === 'declaredRowShortfall' ? 1 : 0;
  return { items: [good, ...bad], unread, groups: [{ rows: [], count }], nextCursor: false };
}

/**
 * Builds an action context for the synthetic provider.
 * @param bus - Router-backed mediator.
 * @returns Action context with a fixed requested window.
 */
function contextFor(bus: IApiMediator): IActionContext & IPipelineContext {
  const base = makeMockContext({ apiMediator: some(bus) });
  return {
    ...base,
    options: { ...base.options, startDate: START },
    executor: none(),
    windowEnd: none(),
  };
}

/**
 * Builds a mediator with one response per account and queued transaction pages.
 * @param pages - Queued transaction responses.
 * @param accountCount - Number of synthetic accounts.
 * @returns A router-backed mediator.
 */
function busFor(pages: readonly Record<string, unknown>[], accountCount: number): IApiMediator {
  const accounts = Array.from({ length: accountCount }, (_, index) => ({
    id: `id-${String(index)}`,
    num: `account-${String(index)}`,
  }));
  return makeRouterBus({
    customer: [succeed({ accts: accounts })],
    balance: accounts.map(() => succeed({ balance: 0 })),
    transactions: pages.map(body => succeed(body)),
  });
}

/**
 * Runs the actual driver followed by the phase's configured result guard.
 * @param pages - Queued transaction responses.
 * @param accountCount - Number of synthetic accounts.
 * @returns The internal scrape and the guard's outcome.
 */
async function runPages(
  pages: readonly Record<string, unknown>[],
  accountCount = 1,
): Promise<{ scrape: IScrapeState; outcome: Procedure<unknown> }> {
  const bus = busFor(pages, accountCount);
  const ctx = contextFor(bus);
  const transactions = {
    ...SYN_CASE.shape.transactions,
    declaredRowSpecs: [{ groups: 'groups', rows: 'rows', count: 'count' }],
  };
  const shape = { ...SYN_CASE.shape, transactions, resultGuard: strictGuard };
  const action = await createApiDirectScrapePhase(shape)(ctx);
  assertOk(action);
  assertHas(action.value.scrape);
  const phase = buildApiDirectScrapePhase(shape);
  const outcome = await phase.post(ctx, { ...ctx, scrape: action.value.scrape });
  return { scrape: action.value.scrape.value, outcome };
}

describe('observed ledger reaches the result guard', () => {
  it.each(LOSS_CHANNELS)('refuses %s after the lower bound is reached', async caveat => {
    const result = await runPages([page(caveat, '2025-12-31')]);
    expect(result.scrape.accounts[0].windowCoverage?.status).toBe('lowerBoundReached');
    expect(result.scrape.observedCaveats).toContain(caveat);
    expect(result.outcome).toMatchObject({ success: false, errorMessage: 'observed row loss' });
  });

  it.each(LOSS_CHANNELS)('refuses %s when backfill cannot move the bound', async caveat => {
    const response = page(caveat, '2026-06-02');
    const result = await runPages([response, response]);
    expect(result.scrape.accounts[0].windowCoverage).toMatchObject({
      status: 'unproven',
      reason: 'boundDidNotMove',
    });
    expect(result.scrape.accounts[0].windowCoverage).not.toHaveProperty('caveats');
    expect(result.scrape.observedCaveats).toContain(caveat);
    expect(result.outcome).toMatchObject({ success: false, errorMessage: 'observed row loss' });
  });

  it('keeps clean zero-balance and empty unproven results valid', async () => {
    const empty = { items: [], groups: [{ rows: [], count: 0 }], nextCursor: false };
    const result = await runPages([empty]);
    expect(result.scrape.accounts[0]).toMatchObject({
      balance: 0,
      txns: [],
      windowCoverage: { status: 'unproven' },
    });
    expect(result.scrape.observedCaveats).toEqual([]);
    expect(result.outcome.success).toBe(true);
  });

  it('aggregates later accounts without putting ledger evidence on public accounts', async () => {
    const short = page('declaredRowShortfall', '2025-12-31');
    const lost = page('mappingRejectedRows', '2025-12-31');
    const result = await runPages([short, lost], 2);
    expect(result.scrape.observedCaveats).toContain('declaredRowShortfall');
    expect(result.scrape.observedCaveats).toContain('mappingRejectedRows');
    expect(result.scrape.accounts).toHaveLength(2);
    const hasOnlyPublicFields = result.scrape.accounts.every(
      account => !('observedCaveats' in account),
    );
    expect(hasOnlyPublicFields).toBe(true);
    expect(result.outcome).toMatchObject({ success: false, errorMessage: 'observed row loss' });
  });

  it('does not turn an unavailable audit into observed row loss', async () => {
    const response = page('clean', '2025-12-31');
    const missingCount = { ...response, groups: [{ rows: [] }] };
    const result = await runPages([missingCount]);
    expect(result.scrape.observedCaveats).toContain('declaredRowAuditUnavailable');
    expect(result.outcome.success).toBe(true);
  });

  it('keeps unavailable evidence distinct from a clean empty snapshot', async () => {
    const shape = { ...SYN_CASE.shape, resultGuard: strictGuard };
    const scrape: IScrapeState = { accounts: [{ accountNumber: 'account', txns: [] }] };
    const ctx = makeMockContext({ scrape: some(scrape) });
    const phase = buildApiDirectScrapePhase(shape);
    const outcome = await phase.post(ctx, ctx);
    expect(outcome).toMatchObject({ success: false, errorMessage: 'evidence unavailable' });
  });
});
