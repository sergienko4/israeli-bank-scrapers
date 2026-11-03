import { installFetchPathWitness } from '../E2eReal/FetchPathWitness.js';

const ORIGINAL_FETCH = globalThis.fetch;
const RESPONSE = new Response(null, { status: 204 });
const FETCH_CALLS: (readonly [string | URL | Request, RequestInit?])[] = [];

/**
 * Deterministic fetch target used to prove witness transparency.
 * @param input - Fetch input.
 * @param init - Fetch options.
 * @returns Synthetic response.
 */
function stubFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  FETCH_CALLS.push([input, init]);
  return Promise.resolve(RESPONSE);
}

describe('FetchPathWitness', () => {
  beforeEach(() => {
    FETCH_CALLS.length = 0;
    globalThis.fetch = stubFetch;
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it.each([
    ['string', 'https://bank.example/login?token=synthetic-secret#fragment'],
    ['URL', new URL('https://bank.example/login?token=synthetic-secret#fragment')],
    ['Request', new Request('https://bank.example/login?token=synthetic-secret#fragment')],
  ])('T-FETCH-PATH-1: records only the pathname from a %s input', async (_kind, input) => {
    const witness = installFetchPathWitness();
    const response = await globalThis.fetch(input);
    expect({ paths: witness.pathsSince(0), response }).toEqual({
      paths: ['/login'],
      response: RESPONSE,
    });
    witness.dispose();
  });

  it('T-FETCH-PATH-2: checkpoints isolate later requests', async () => {
    const witness = installFetchPathWitness();
    await globalThis.fetch('https://bank.example/regularLogin');
    const checkpoint = witness.checkpoint();
    await globalThis.fetch('https://bank.example/bioLogin?hash=synthetic-secret');
    const warmPaths = witness.pathsSince(checkpoint);
    expect(warmPaths).toEqual(['/bioLogin']);
    witness.dispose();
  });

  it('T-FETCH-PATH-3: dispose restores the wrapped fetch', () => {
    const witness = installFetchPathWitness();
    witness.dispose();
    expect(globalThis.fetch).toBe(stubFetch);
  });
});
