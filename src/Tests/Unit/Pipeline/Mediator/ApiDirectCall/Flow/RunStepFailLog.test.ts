/**
 * Log-safety oracle for RunStep firePost failures.
 *
 * The transport's failure text can echo request material (query
 * values, response snippets). RunStep must log it only as a
 * `<msg:N>` length tag while still returning the failure unchanged.
 */

import { jest } from '@jest/globals';

import type { IStepConfig } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { ITemplateScope } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/RefResolver.js';
import type { WKUrlGroup } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { createDebugMock } from '../../../../../MockModuleFactories.js';

const DEBUG_SPY = jest.fn();
const MOCK_LOGGER = { debug: DEBUG_SPY, info: jest.fn(), warn: jest.fn(), error: jest.fn() };
const GET_DEBUG = jest.fn();
GET_DEBUG.mockReturnValue(MOCK_LOGGER);

jest.unstable_mockModule('../../../../../../Scrapers/Pipeline/Logging/Debug.js', () => ({
  ...createDebugMock(),
  getDebug: GET_DEBUG,
}));

const DEFS = await import('../../../../../../Definitions.js');
const ERRS = await import('../../../../../../Scrapers/Base/ErrorTypes.js');
const RUN_STEP =
  await import('../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.js');
const URLS_WK = await import('../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js');
const PROC = await import('../../../../../../Scrapers/Pipeline/Types/Procedure.js');
const STUB = await import('./StubMediator.js');

const URL_TAG: WKUrlGroup = 'auth.bind';
const HINT = DEFS.CompanyTypes.OneZero;
const SECRET = 'otp-canary-7b1e94d0c3';
const FAILURE_TEXT = `POST failed: https://example.test/api/fail?code=${SECRET}`;

beforeAll((): void => {
  URLS_WK.registerWkUrl(URL_TAG, HINT, 'https://example.test/api/fail');
});

/**
 * Empty template scope with a minimal config.
 * @returns Template scope.
 */
function makeScope(): ITemplateScope {
  const config = { flow: 'sms-otp', steps: [], envelope: {}, probe: { queryTag: 'customer' } };
  return { carry: {}, creds: {}, config, keypair: undefined } as unknown as ITemplateScope;
}

/**
 * Serialise one recorded debug call.
 * @param call - Arguments of one LOG.debug call.
 * @returns The call arguments as JSON.
 */
function callToJson(call: unknown[]): string {
  return JSON.stringify(call);
}

/**
 * Serialise every debug call recorded so far.
 * @returns All debug records joined by newlines.
 */
function debugLines(): string {
  const records = DEBUG_SPY.mock.calls.map(callToJson);
  return records.join('\n');
}

describe('api-direct-call RunStep firePost failure log safety', () => {
  it('logs the failure text as a length tag and returns it verbatim', async () => {
    const failure = PROC.fail(ERRS.ScraperErrorTypes.Generic, FAILURE_TEXT);
    const bus = STUB.makeStubMediator({ responses: [failure], captures: [] });
    const step: IStepConfig = {
      name: 'bind',
      urlTag: URL_TAG,
      body: { shape: {} },
      extractsToCarry: {},
    };
    const scope = makeScope();
    const result = await RUN_STEP.runStep({ step, bus, scope, companyId: HINT });
    const logged = debugLines();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toBe(FAILURE_TEXT);
    expect(logged).toContain('firePost FAIL');
    expect(logged).toContain('<msg:');
    expect(logged).not.toContain(SECRET);
  });
});
