/**
 * A step may carry response headers. `headerExtractsToCarry` names a
 * carry slot per header; the real mediator over the headless native transport
 * answers from a fake fetch, and the step's carry is read back.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import type {
  IApiDirectCallConfig,
  IGetStep,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { attachHeaderCapture } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.headerCarry.js';
import { runStep } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.js';
import type { IFireArgs } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.types.js';
import type { ITemplateScope } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/RefResolver.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import type { HeaderPair } from '../../../../../Helpers/NativeStepHarness.js';
import { installJsonAnswer, makeNativeMediator } from '../../../../../Helpers/NativeStepHarness.js';

const HINT = CompanyTypes.OneZero;
const ORIGIN = 'https://example.test';
const STALE_URL = `${ORIGIN}/api/bind?try=1`;
const FRESH_URL = `${ORIGIN}/api/bind?try=2`;

const PLAIN_CONFIG: IApiDirectCallConfig = {
  flow: 'sms-otp',
  steps: [],
  envelope: {},
  probe: { queryTag: 'customer' },
};

const CARRY_STEP: IGetStep = {
  name: 'bind',
  urlTag: 'auth.bind',
  method: 'GET',
  extractsToCarry: { token: '/access_token' },
  headerExtractsToCarry: { sessionId: { header: 'X-Session-Id' } },
};

const TOKEN_BODY = { access_token: 'syn-token' };

const ANSWER_HEADERS: readonly HeaderPair[] = [
  ['x-session-id', 'syn-session'],
  ['x-trace', 'syn-trace'],
];

beforeAll((): void => {
  registerWkUrl('auth.bind', HINT, `${ORIGIN}/api/bind`);
});

/**
 * Build an empty template scope.
 * @returns Template scope.
 */
function makeScope(): ITemplateScope {
  return { carry: {}, creds: {}, config: PLAIN_CONFIG, keypair: undefined };
}

describe('response-header carry over the headless native transport', () => {
  const originalFetch = globalThis.fetch;

  afterEach((): void => {
    globalThis.fetch = originalFetch;
  });

  it('UT-HC-01 carries a declared header beside the body extracts, nothing else', async () => {
    installJsonAnswer(TOKEN_BODY, ANSWER_HEADERS);
    const bus = makeNativeMediator(HINT, ORIGIN);
    const result = await runStep({ step: CARRY_STEP, bus, scope: makeScope(), companyId: HINT });
    const carry = result.success ? result.value.carry : {};
    const tsMs = expect.any(String) as unknown;
    expect(carry).toEqual({ token: 'syn-token', sessionId: 'syn-session', tsMs });
  });

  it('UT-HC-02 carries the fallback when the header is missing', async () => {
    installJsonAnswer(TOKEN_BODY, []);
    const headerExtractsToCarry = { sessionId: { header: 'X-Session-Id', fallback: 'none' } };
    const step: IGetStep = { ...CARRY_STEP, headerExtractsToCarry };
    const bus = makeNativeMediator(HINT, ORIGIN);
    const result = await runStep({ step, bus, scope: makeScope(), companyId: HINT });
    expect(result).toMatchObject({ success: true, value: { carry: { sessionId: 'none' } } });
  });

  it('UT-HC-03 fails the step when a header without fallback is missing', async () => {
    installJsonAnswer(TOKEN_BODY, [['x-trace', 'syn-trace']]);
    const bus = makeNativeMediator(HINT, ORIGIN);
    const result = await runStep({ step: CARRY_STEP, bus, scope: makeScope(), companyId: HINT });
    expect(result).toMatchObject({ success: false, errorMessage: 'bind header missing' });
  });

  it('UT-HC-04 keeps only the last answer headers and URL, never a superseded one', () => {
    const fire: IFireArgs = { body: {}, query: {}, extraHeaders: {} };
    const capture = attachHeaderCapture(fire, CARRY_STEP).headerCapture;
    capture?.sink.take({ 'x-session-id': 'syn-stale' }, 401, STALE_URL);
    capture?.sink.take({}, 200, FRESH_URL);
    const seen = [...(capture?.seen ?? [])];
    expect(seen).toEqual([]);
    expect(capture?.urls).toEqual([FRESH_URL]);
  });
});
