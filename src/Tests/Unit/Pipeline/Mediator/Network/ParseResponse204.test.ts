/**
 * Diagnostic test per debugging-guidlines.md §1.2 ("Write a failing
 * test BEFORE fixing"). Live Hapoalim run `15-05-2026_11025238`
 * showed the bank's real txn URL fired as POST with status 204
 * but never entered the captured pool (`tier='none', matches=1`
 * post-fix), meaning `parseResponse` returned `false` despite the
 * status===204 short-circuit. This test pins ground truth.
 *
 * <p>Mocks a minimal Playwright `Response` with status=204 + empty
 * body + 'none' content-type (the live shape). Asserts
 * `parseResponse` returns an `IDiscoveredEndpoint` with
 * `responseBody === null`.
 */

import { parseResponse } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import { type IMockArgs, makeMockResponse } from './_makeMockResponse.js';

/** Synthetic args helper — sets the live-Hapoalim shape defaults. */
const DEFAULT_ARGS: IMockArgs = {
  status: 200,
  contentType: '',
  text: '',
  url: 'https://bank.fake.example/api/txns',
  method: 'POST',
  postData: '',
};

describe('parseResponse — diagnostic for live 204 drop (debugging-guidlines.md §1.2)', () => {
  it('PR-204-NO-CONTENT-TYPE returns endpoint with responseBody=null for status=204 + no content-type', async (): Promise<void> => {
    const mock = makeMockResponse({ ...DEFAULT_ARGS, status: 204 });
    const result = await parseResponse(mock);

    expect(result).not.toBe(false);
    if (result !== false) {
      expect(result.responseBody).toBeNull();
      expect(result.status).toBe(204);
      expect(result.url).toBe('https://bank.fake.example/api/txns');
    }
  });

  it('PR-204-WITH-CONTENT-TYPE returns endpoint for status=204 + application/json', async (): Promise<void> => {
    const mock = makeMockResponse({
      ...DEFAULT_ARGS,
      status: 204,
      contentType: 'application/json',
    });
    const result = await parseResponse(mock);

    expect(result).not.toBe(false);
    if (result !== false) {
      expect(result.responseBody).toBeNull();
    }
  });

  it('PR-200-JSON returns endpoint with body for status=200 + application/json + valid JSON', async (): Promise<void> => {
    const mock = makeMockResponse({
      ...DEFAULT_ARGS,
      status: 200,
      contentType: 'application/json',
      text: '{"transactions":[]}',
    });
    const result = await parseResponse(mock);

    expect(result).not.toBe(false);
    if (result !== false) {
      expect(result.responseBody).toEqual({ transactions: [] });
      expect(result.status).toBe(200);
    }
  });

  it('PR-200-IMAGE returns false for binary asset (existing JSON-only filter)', async (): Promise<void> => {
    const mock = makeMockResponse({
      ...DEFAULT_ARGS,
      status: 200,
      contentType: 'image/png',
    });
    const result = await parseResponse(mock);

    expect(result).toBe(false);
  });
});
