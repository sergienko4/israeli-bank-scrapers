/**
 * parseResponse catch-path log: a captured response that fails JSON
 * parsing is logged by position only — never by the body V8 quotes.
 */

import { jest } from '@jest/globals';

import { type IMockArgs, makeMockResponse } from './_makeMockResponse.js';

const LOG = {
  trace: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

jest.unstable_mockModule('../../../../../Scrapers/Pipeline/Logging/Debug.js', async () => ({
  ...(await import('../../../../../Scrapers/Pipeline/Logging/BankContext.js')),
  /**
   * Supply the shared logger to the module under test.
   * @returns Shared logger mock.
   */
  getDebug: (): typeof LOG => LOG,
  /**
   * Preserve the legacy logger factory surface.
   * @returns Shared logger mock.
   */
  getDebugByName: (): typeof LOG => LOG,
}));

const { parseResponse: PARSE_RESPONSE } =
  await import('../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js');

/** Account number the rejected body carries; must never be logged. */
const ACCOUNT_SENTINEL = '4580123412341234';

const NON_JSON_RESPONSE: IMockArgs = {
  status: 200,
  contentType: 'application/json',
  text: `ACCT${ACCOUNT_SENTINEL}`,
  url: 'https://bank.fake.example/api/txns',
  method: 'POST',
  postData: '',
};

describe('parseResponse — catch-path log', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('logs the parse failure by kind, never the rejected body', async () => {
    const mock = makeMockResponse(NON_JSON_RESPONSE);

    const result = await PARSE_RESPONSE(mock);

    const logged = JSON.stringify(LOG.debug.mock.calls);
    expect(result).toBe(false);
    expect(logged).toContain('"errorMessage":"invalid JSON (SyntaxError)"');
    expect(logged).not.toContain(ACCOUNT_SENTINEL);
  });
});
