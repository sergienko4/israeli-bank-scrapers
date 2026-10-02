/**
 * Log-safety oracle for the browser-capture body-parse failure log.
 *
 * V8's JSON.parse SyntaxError quotes the response body it failed on,
 * so a raw message would copy body material into the debug log. The
 * failure must be logged only as a `<msg:N>` length tag.
 */

import { jest } from '@jest/globals';

import type { IRequestMeta } from '../../../../../Scrapers/Pipeline/Mediator/Network/Indexing/ResponsePrimitives.js';
import { createDebugMock } from '../../../../MockModuleFactories.js';

const DEBUG_SPY = jest.fn();
const MOCK_LOGGER = { debug: DEBUG_SPY, info: jest.fn(), warn: jest.fn(), error: jest.fn() };
const GET_DEBUG = jest.fn();
GET_DEBUG.mockReturnValue(MOCK_LOGGER);

jest.unstable_mockModule('../../../../../Scrapers/Pipeline/Logging/Debug.js', () => ({
  ...createDebugMock(),
  getDebug: GET_DEBUG,
}));

const LOGS =
  await import('../../../../../Scrapers/Pipeline/Mediator/Network/Indexing/ResponseParserLogs.js');
const PRIMS =
  await import('../../../../../Scrapers/Pipeline/Mediator/Network/Indexing/ResponsePrimitives.js');

const SECRET = 'tok-canary-4e8a1f';
const META: IRequestMeta = {
  url: 'https://api.bank.example/auth/token',
  method: 'POST',
  postData: '',
  contentType: 'application/json',
  requestHeaders: {},
  resourceType: 'xhr',
};

/**
 * Capture the SyntaxError the real body parser throws on `body`.
 * @param body - Response body text that is not valid JSON.
 * @returns The thrown parse error.
 */
function parseErrorOf(body: string): Error {
  try {
    PRIMS.parseTextOrNull(body);
  } catch (error) {
    return error as Error;
  }
  return new Error('body unexpectedly parsed');
}

describe('logParseCatch — body-parse failure log safety', () => {
  it('logs the parse error as a length tag without the echoed body', () => {
    const error = parseErrorOf(SECRET);
    LOGS.logParseCatch(META, 200, error);
    const logged = JSON.stringify(DEBUG_SPY.mock.calls);
    expect(error.message).toContain(SECRET);
    expect(logged).toContain('parseResponse.catch');
    expect(logged).toContain('<msg:');
    expect(logged).not.toContain(SECRET);
  });
});
