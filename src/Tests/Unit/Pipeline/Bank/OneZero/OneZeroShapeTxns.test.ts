/**
 * Branch coverage for OneZeroShapeTxns — stop predicate + cursor logic.
 */

import {
  stopPredicate,
  txnsExtractPage,
  txnsVars,
} from '../../../../../Scrapers/Pipeline/Banks/OneZero/scrape/OneZeroShapeTxns.js';
import type { IActionContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { makeMockContext, makeMockOptions } from '../../Infrastructure/MockFactories.js';

const ACCT = { portfolioId: 'pf', portfolioNum: 'num', accountId: 'acc' };

/**
 * Build an action context with a fixed startDate.
 * @param startDate - Start-date threshold seeded into ScraperOptions.
 * @returns Action context.
 */
function ctxFor(startDate: Date): IActionContext {
  const opts = makeMockOptions({ startDate });
  return makeMockContext({ options: opts }) as unknown as IActionContext;
}

describe('OneZeroShapeTxns.txnsVars', () => {
  it('uses null cursor sentinel on first-page call', () => {
    const vars = txnsVars(ACCT, false) as { pagination: { cursor: unknown } };
    expect(vars.pagination.cursor).toBeNull();
  });
  it('passes through the cursor on subsequent calls', () => {
    const vars = txnsVars(ACCT, 'abc') as { pagination: { cursor: string } };
    expect(vars.pagination.cursor).toBe('abc');
  });
});

describe('OneZeroShapeTxns.txnsExtractPage', () => {
  it('emits nextCursor=false when hasMore is false', () => {
    const body = { movements: { movements: [], pagination: { cursor: 'c', hasMore: false } } };
    const page = txnsExtractPage(body);
    expect(page.nextCursor).toBe(false);
  });
  it('emits nextCursor=false when cursor is null (coerced)', () => {
    const body = { movements: { movements: [], pagination: { cursor: null, hasMore: true } } };
    const page = txnsExtractPage(body);
    expect(page.nextCursor).toBe(false);
  });
  it('emits nextCursor=false when cursor is empty string', () => {
    const body = { movements: { movements: [], pagination: { cursor: '', hasMore: true } } };
    const page = txnsExtractPage(body);
    expect(page.nextCursor).toBe(false);
  });
  it('returns the cursor string when hasMore=true + non-empty cursor', () => {
    const body = { movements: { movements: [], pagination: { cursor: 'next', hasMore: true } } };
    const page = txnsExtractPage(body);
    expect(page.nextCursor).toBe('next');
  });
});

describe('OneZeroShapeTxns.stopPredicate', () => {
  it('returns false on empty accumulator', () => {
    const ctx = ctxFor(new Date('2020-01-01'));
    const isStopped = stopPredicate([], ctx);
    expect(isStopped).toBe(false);
  });
  it('returns false when last row has non-string timestamp', () => {
    const ctx = ctxFor(new Date('2020-01-01'));
    const isStopped = stopPredicate([{ movementTimestamp: 42 }], ctx);
    expect(isStopped).toBe(false);
  });
  it('returns false when last row timestamp is empty string', () => {
    const ctx = ctxFor(new Date('2020-01-01'));
    const isStopped = stopPredicate([{ movementTimestamp: '' }], ctx);
    expect(isStopped).toBe(false);
  });
  it('returns true when last movement predates startDate', () => {
    const ctx = ctxFor(new Date('2026-01-01'));
    const acc = [{ movementTimestamp: '2019-01-01T00:00:00Z' }];
    const isStopped = stopPredicate(acc, ctx);
    expect(isStopped).toBe(true);
  });
  it('returns false when last movement is after startDate', () => {
    const ctx = ctxFor(new Date('2026-01-01'));
    const acc = [{ movementTimestamp: '2026-06-01T00:00:00Z' }];
    const isStopped = stopPredicate(acc, ctx);
    expect(isStopped).toBe(false);
  });
});
