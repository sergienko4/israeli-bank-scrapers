/**
 * A recording `fetch` fake for tests of the browser-stack scripts.
 *
 * It answers through `reply(url)` and keeps every request, so a test can
 * assert what was sent without leaving the machine.
 */

/** One request the fake received. */
export interface IFetchCall {
  readonly url: string;
  readonly init: RequestInit;
}

/** A fetch fake and the requests it saw; pass it as the fetch I/O override. */
export interface IFetchFake {
  readonly fetchImpl: (url: string, init: RequestInit) => Promise<Response>;
  readonly calls: IFetchCall[];
}

/**
 * Build a fetch that records each request and answers it with `reply(url)`.
 *
 * @param reply - Builds the response for one URL.
 * @returns The fake.
 */
export function fakeFetch(reply: (url: string) => Response): IFetchFake {
  const calls: IFetchCall[] = [];
  return {
    calls,
    /**
     * Record, then answer.
     *
     * @param url - Requested URL.
     * @param init - Request options.
     * @returns The response.
     */
    fetchImpl: (url: string, init: RequestInit): Promise<Response> => {
      calls.push({ url, init });
      const response = reply(url);
      return Promise.resolve(response);
    },
  };
}

/**
 * Build a fetch that answers every request with HTTP 200 and one body.
 *
 * @param body - Response body.
 * @returns The fake.
 */
export function serving(body: string): IFetchFake {
  return fakeFetch((): Response => new Response(body, { status: 200 }));
}
