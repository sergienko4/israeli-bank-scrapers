/**
 * Unit tests for Strategy/Fetch/Pagination — generic cursor helper.
 * Cover single-page, multi-page, stop-predicate, empty page, failure propagation,
 * and generic typing with both string and numeric cursors.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import {
  fetchPaginated,
  type IFetchPaginatedArgs,
  type IPage,
} from '../../../../../Scrapers/Pipeline/Strategy/Fetch/Pagination.js';
import {
  fail,
  isOk,
  type Procedure,
  succeed,
} from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

type PageFetcher<TItem, TCursor> = (
  cursor: TCursor | false,
) => Promise<Procedure<IPage<TItem, TCursor>>>;

/**
 * Build a paged-fetch mock that emits the supplied pages in order, one per call.
 * @param pages - Fixed sequence of pages to serve on successive fetchPage calls.
 * @returns A fetchPage function matching the IFetchPaginatedArgs signature.
 */
function makePagedFetcher<TItem, TCursor>(
  pages: readonly IPage<TItem, TCursor>[],
): PageFetcher<TItem, TCursor> {
  const callState: { count: number } = { count: 0 };
  /**
   * Serve the next page from the prebuilt sequence.
   * @returns Promise resolving to the next page wrapped in succeed().
   */
  const fetcher: PageFetcher<TItem, TCursor> = (): Promise<Procedure<IPage<TItem, TCursor>>> => {
    const page = pages[callState.count];
    callState.count += 1;
    const ok = succeed(page);
    return Promise.resolve(ok);
  };
  return fetcher;
}

/**
 * Stop-predicate that never halts — loop exits only via cursor exhaustion or fail.
 * @returns Always false, meaning "do not stop yet".
 */
const NEVER_STOP = (): boolean => false;

describe('Pagination.fetchPaginated', () => {
  it('exhausts in a single page when nextCursor is false immediately', async () => {
    const pages: IPage<string, string>[] = [{ items: ['a', 'b', 'c'], nextCursor: false }];
    const fetchPage = makePagedFetcher(pages);
    const args: IFetchPaginatedArgs<string, string> = { fetchPage, stop: NEVER_STOP };
    const result = await fetchPaginated(args);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual(['a', 'b', 'c']);
    }
  });

  it('accumulates items across multiple pages until nextCursor === false', async () => {
    const pages: IPage<string, string>[] = [
      { items: ['a', 'b'], nextCursor: 'cursor-1' },
      { items: ['c', 'd'], nextCursor: 'cursor-2' },
      { items: ['e'], nextCursor: false },
    ];
    const fetchPage = makePagedFetcher(pages);
    const args: IFetchPaginatedArgs<string, string> = { fetchPage, stop: NEVER_STOP };
    const result = await fetchPaginated(args);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual(['a', 'b', 'c', 'd', 'e']);
    }
  });

  it('forwards cursor between pages — page N sees cursor from page N-1', async () => {
    const observedCursors: (string | false)[] = [];
    const pages: IPage<string, string>[] = [
      { items: ['x'], nextCursor: 'c-alpha' },
      { items: ['y'], nextCursor: 'c-beta' },
      { items: ['z'], nextCursor: false },
    ];
    const internal = { count: 0 };
    /**
     * Serve next page while recording the cursor the helper passed in.
     * @param cursor - Cursor value received from fetchPaginated for this call.
     * @returns Promise resolving to the next page wrapped in succeed().
     */
    const fetchPage: PageFetcher<string, string> = (
      cursor: string | false,
    ): Promise<Procedure<IPage<string, string>>> => {
      observedCursors.push(cursor);
      const page = pages[internal.count];
      internal.count += 1;
      const ok = succeed(page);
      return Promise.resolve(ok);
    };
    const args: IFetchPaginatedArgs<string, string> = { fetchPage, stop: NEVER_STOP };
    const result = await fetchPaginated<string, string>(args);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
    expect(observedCursors).toEqual([false, 'c-alpha', 'c-beta']);
  });

  it('stops mid-stream when the stop predicate returns true before cursor exhausts', async () => {
    const pages: IPage<string, string>[] = [
      { items: ['a', 'b', 'c', 'd', 'e'], nextCursor: 'next-1' },
      { items: ['f', 'g', 'h', 'i', 'j', 'k'], nextCursor: 'next-2' },
      { items: ['l', 'm'], nextCursor: 'next-3' },
    ];
    const fetchPage = makePagedFetcher(pages);
    /**
     * Stop once the accumulator has at least 10 items.
     * @param acc - Accumulated items so far.
     * @returns True when the 10-item threshold is crossed.
     */
    const stop = (acc: readonly string[]): boolean => acc.length >= 10;
    const args: IFetchPaginatedArgs<string, string> = { fetchPage, stop };
    const result = await fetchPaginated(args);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
    if (isOk(result)) {
      expect(result.value.length).toBeGreaterThanOrEqual(10);
      expect(result.value.length).toBeLessThan(13);
    }
  });

  it('terminates cleanly on an empty first page', async () => {
    const pages: IPage<string, string>[] = [{ items: [], nextCursor: false }];
    const fetchPage = makePagedFetcher(pages);
    const args: IFetchPaginatedArgs<string, string> = { fetchPage, stop: NEVER_STOP };
    const result = await fetchPaginated(args);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual([]);
    }
  });

  it('propagates fail() unchanged on fetchPage failure — no retry', async () => {
    const callState: { count: number } = { count: 0 };
    /**
     * Always fail — lets the test assert zero retry and unchanged propagation.
     * @returns A resolved promise carrying a NetworkError fail Procedure.
     */
    const fetchPage: PageFetcher<string, string> = (): Promise<
      Procedure<IPage<string, string>>
    > => {
      callState.count += 1;
      const failure = fail(ScraperErrorTypes.NetworkError, 'boom');
      return Promise.resolve(failure);
    };
    const args: IFetchPaginatedArgs<string, string> = { fetchPage, stop: NEVER_STOP };
    const result = await fetchPaginated(args);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(false);
    if (!isOk(result)) {
      expect(result.errorType).toBe(ScraperErrorTypes.NetworkError);
      expect(result.errorMessage).toBe('boom');
    }
    expect(callState.count).toBe(1);
  });

  it('supports numeric cursors (TCursor = number) end-to-end', async () => {
    const pages: IPage<string, number>[] = [
      { items: ['p1-a'], nextCursor: 1 },
      { items: ['p2-a', 'p2-b'], nextCursor: 2 },
      { items: ['p3-a'], nextCursor: false },
    ];
    const fetchPage = makePagedFetcher(pages);
    const args: IFetchPaginatedArgs<string, number> = { fetchPage, stop: NEVER_STOP };
    const result = await fetchPaginated(args);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual(['p1-a', 'p2-a', 'p2-b', 'p3-a']);
    }
  });
});

/**
 * A page fetcher that always answers with the same cursor it was handed.
 *
 * This is what a provider does when the bound it is given cannot split the data
 * any further — the shape derives the same cursor from the same rows, for ever.
 *
 * @param seen - Cursors the walk asked under, appended to as it goes.
 * @returns A fetchPage that never exhausts.
 */
function makeStuckFetcher(seen: (string | false)[]): PageFetcher<string, string> {
  return (cursor: string | false): Promise<Procedure<IPage<string, string>>> => {
    seen.push(cursor);
    const page: IPage<string, string> = { items: ['same'], nextCursor: 'stuck' };
    const ok = succeed(page);
    return Promise.resolve(ok);
  };
}

/**
 * A merge that appends only the rows not already held.
 * @param held - Rows accumulated so far.
 * @param incoming - Rows the new page carried.
 * @returns The held rows plus whatever was genuinely new.
 */
function dropAlreadyHeld(held: readonly string[], incoming: readonly string[]): readonly string[] {
  const fresh = incoming.filter((item): boolean => !held.includes(item));
  return [...held, ...fresh];
}

describe('Pagination.fetchPaginated/walks that stop making progress', () => {
  it('halts instead of looping when the cursor stops moving', async () => {
    const seen: (string | false)[] = [];
    const fetchPage = makeStuckFetcher(seen);
    const args: IFetchPaginatedArgs<string, string> = { fetchPage, stop: NEVER_STOP };
    const result = await fetchPaginated(args);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
    // Seed ask, then the ask under 'stuck' which hands 'stuck' straight back.
    expect(seen).toEqual([false, 'stuck']);
  });

  it('keeps the rows it gathered before halting', async () => {
    const fetchPage = makeStuckFetcher([]);
    const args: IFetchPaginatedArgs<string, string> = { fetchPage, stop: NEVER_STOP };
    const result = await fetchPaginated(args);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
    const rows = isOkResult ? result.value : [];
    expect(rows).toEqual(['same', 'same']);
  });

  it('lets a merge collapse the rows a repeated ask re-served', async () => {
    // What an overlap-declaring shape gets: the second ask re-serves the row,
    // and the merge drops it rather than reporting the same transaction twice.
    const fetchPage = makeStuckFetcher([]);
    const args: IFetchPaginatedArgs<string, string> = {
      fetchPage,
      stop: NEVER_STOP,
      merge: dropAlreadyHeld,
    };
    const result = await fetchPaginated(args);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
    const rows = isOkResult ? result.value : [];
    expect(rows).toEqual(['same']);
  });
});

/**
 * Build a fetcher whose cursor advances on every page, so it never exhausts and
 * never repeats a cursor — only the page ceiling can stop the walk.
 * @param asks - Collects the cursor of each fetch, so length is the ask count.
 * @returns A fetchPage function matching the IFetchPaginatedArgs signature.
 */
function makeEndlessFetcher(asks: number[]): PageFetcher<string, number> {
  return (cursor): Promise<Procedure<IPage<string, number>>> => {
    const next = cursor === false ? 1 : cursor + 1;
    asks.push(next);
    const page = succeed({ items: ['row'], nextCursor: next });
    return Promise.resolve(page);
  };
}

describe('Pagination.fetchPaginated/the runaway ceiling', () => {
  it('stops a never-exhausting walk and keeps what it gathered', async () => {
    const asks: number[] = [];
    const fetchPage = makeEndlessFetcher(asks);
    const args: IFetchPaginatedArgs<string, number> = { fetchPage, stop: NEVER_STOP };
    const result = await fetchPaginated(args);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
    expect(asks).toHaveLength(300);
    const rows = isOkResult ? result.value : [];
    expect(rows).toHaveLength(300);
  });
});
