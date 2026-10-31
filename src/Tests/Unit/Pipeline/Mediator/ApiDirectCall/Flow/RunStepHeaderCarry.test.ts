/**
 * N6 — a step may carry response headers. `headerExtractsToCarry` names a
 * carry slot per header; the real mediator over the headless native transport
 * answers from a fake fetch, and the step's carry is read back.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import { createApiMediator } from '../../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import type {
  IApiDirectCallConfig,
  IGetStep,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { runStep } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.js';
import type { ITemplateScope } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/RefResolver.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import type { GraphQLFetchStrategy } from '../../../../../../Scrapers/Pipeline/Strategy/Fetch/GraphQLFetchStrategy.js';
import { HeadlessNativeFetchStrategy } from '../../../../../../Scrapers/Pipeline/Strategy/Fetch/HeadlessNativeFetchStrategy.js';
import type { ITokenBus } from '../../../../../../Scrapers/Pipeline/Types/Domain/TokenBus.js';
import { fakeFetch } from '../../../../../Helpers/FakeFetch.js';

const HINT = CompanyTypes.OneZero;
const ORIGIN = 'https://example.test';

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

const ANSWER_HEADERS: readonly [string, string][] = [
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

/**
 * Point globalThis.fetch at a fake that answers a token with these headers.
 * @param headers - Response headers.
 * @returns The number of headers served.
 */
function installAnswer(headers: readonly [string, string][]): number {
  const fake = fakeFetch((): Response => {
    const init = { headers: new Headers([...headers]) };
    return Response.json({ access_token: 'syn-token' }, init);
  });
  globalThis.fetch = fake.fetchImpl as typeof globalThis.fetch;
  return headers.length;
}

/**
 * Real mediator over the real headless native transport.
 * @returns Mediator bound to the fake fetch.
 */
function makeNativeMediator(): ITokenBus {
  const graphql = {} as unknown as GraphQLFetchStrategy;
  const transport = new HeadlessNativeFetchStrategy(ORIGIN);
  return createApiMediator(HINT, transport, graphql);
}

describe('N6 response-header carry over the headless native transport', () => {
  const originalFetch = globalThis.fetch;

  afterEach((): void => {
    globalThis.fetch = originalFetch;
  });

  it('UT-HC-01 carries a declared header beside the body extracts, nothing else', async () => {
    installAnswer(ANSWER_HEADERS);
    const bus = makeNativeMediator();
    const result = await runStep({ step: CARRY_STEP, bus, scope: makeScope(), companyId: HINT });
    const carry = result.success ? result.value.carry : {};
    const tsMs = expect.any(String) as unknown;
    expect(carry).toEqual({ token: 'syn-token', sessionId: 'syn-session', tsMs });
  });

  it('UT-HC-02 carries the fallback when the header is missing', async () => {
    installAnswer([]);
    const headerExtractsToCarry = { sessionId: { header: 'X-Session-Id', fallback: 'none' } };
    const step: IGetStep = { ...CARRY_STEP, headerExtractsToCarry };
    const bus = makeNativeMediator();
    const result = await runStep({ step, bus, scope: makeScope(), companyId: HINT });
    expect(result).toMatchObject({ success: true, value: { carry: { sessionId: 'none' } } });
  });

  it('UT-HC-03 fails the step when a header without fallback is missing', async () => {
    installAnswer([['x-trace', 'syn-trace']]);
    const bus = makeNativeMediator();
    const result = await runStep({ step: CARRY_STEP, bus, scope: makeScope(), companyId: HINT });
    expect(result).toMatchObject({ success: false, errorMessage: 'bind header missing' });
  });
});
