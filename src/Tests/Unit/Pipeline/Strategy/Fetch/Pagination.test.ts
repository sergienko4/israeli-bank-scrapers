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
