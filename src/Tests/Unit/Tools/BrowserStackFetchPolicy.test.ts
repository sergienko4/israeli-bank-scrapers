/**
 * Unit tests for the fetch policy of `scripts/browser-stack/fetch-protocol.mjs`.
 *
 * <p>The gate's own policy is covered by CheckBrowserStackCli.test.ts. These
 * tests cover what a caller-supplied policy changes: the hosts a fetch may
 * reach, redirect hops included; the body cap; and the headers sent. The
 * network is a fake `fetch`, so no case leaves the machine.
 */

import {
  fetchBounded,
  type IFetchPolicy,
} from '../../../../scripts/browser-stack/fetch-protocol.mjs';

const API_HOST = 'api.example.test';
const API_URL = `https://${API_HOST}/releases`;
const BODY = '[{"tag_name":"v1"}]';

/** A policy that reaches only {@link API_HOST}, with a small cap and one header. */
const POLICY: IFetchPolicy = Object.freeze({
  hosts: Object.freeze([API_HOST]),
  maxBodyBytes: 64,
  headers: Object.freeze({ accept: 'application/json' }),
});

/** A fetch fake and the requests it saw. */
interface IFetchFake {
  readonly fetchImpl: (url: string, init: RequestInit) => Promise<Response>;
  readonly calls: { url: string; init: RequestInit }[];
}

/**
 * Build a fetch that records each request and answers it with `reply()`.
 *
 * @param reply - Builds the response.
 * @returns The fake.
 */
function fakeFetch(reply: () => Response): IFetchFake {
  const calls: IFetchFake['calls'] = [];
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
      const response = reply();
      return Promise.resolve(response);
    },
  };
}

/**
 * Build a fetch that answers every request with one body.
 *
 * @param body - Response body.
 * @returns The fake.
 */
function serving(body: string): IFetchFake {
  return fakeFetch((): Response => new Response(body, { status: 200 }));
}

/**
 * Build a fetch that redirects every request to `location`.
 *
 * @param location - Redirect target.
 * @returns The fake.
 */
function redirecting(location: string): IFetchFake {
  return fakeFetch((): Response => new Response(null, { status: 302, headers: { location } }));
}

describe('fetchBounded policy', () => {
  it('[BFP-1] reaches a policy host and sends the policy headers', async () => {
    const fake = serving(BODY);
    const fetched = await fetchBounded(API_URL, POLICY, fake);
    expect(fetched.text).toBe(BODY);
    expect(fake.calls[0].init.headers).toEqual({ accept: 'application/json' });
  });

  it('[BFP-2] refuses a host outside the policy without sending anything', async () => {
    const fake = serving(BODY);
    const fetching = fetchBounded('https://raw.githubusercontent.com/x', POLICY, fake);
    await expect(fetching).rejects.toThrow(`is not allowlisted (only https://${API_HOST})`);
    expect(fake.calls).toHaveLength(0);
  });

  it('[BFP-3] refuses a redirect hop outside the policy', async () => {
    const fake = redirecting('https://elsewhere.test/releases');
    const fetching = fetchBounded(API_URL, POLICY, fake);
    await expect(fetching).rejects.toThrow('https://elsewhere.test/releases is not allowlisted');
    expect(fake.calls).toHaveLength(1);
  });

  it('[BFP-4] caps the body at the policy limit, not the gate one', async () => {
    const oversized = 'x'.repeat(POLICY.maxBodyBytes + 1);
    const fake = serving(oversized);
    const fetching = fetchBounded(API_URL, POLICY, fake);
    await expect(fetching).rejects.toThrow(`body exceeds ${String(POLICY.maxBodyBytes)} bytes`);
  });
});
