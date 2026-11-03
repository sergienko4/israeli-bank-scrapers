/**
 * The answer classifier on the wire. A step's classifier runs on its
 * opened answer after `failIfPresent` and `outcome` and before its extracts;
 * the matched case's name and captures land in carry beside the extracts. The
 * cases drive the real mediator over the headless native transport.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import { createApiMediator } from '../../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import type {
  IApiDirectCallConfig,
  IPostStep,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { JsonValue } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Envelope/JsonPointer.js';
import { runStep } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.js';
import type { ITemplateScope } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/RefResolver.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import type { GraphQLFetchStrategy } from '../../../../../../Scrapers/Pipeline/Strategy/Fetch/GraphQLFetchStrategy.js';
import { HeadlessNativeFetchStrategy } from '../../../../../../Scrapers/Pipeline/Strategy/Fetch/HeadlessNativeFetchStrategy.js';
import type { Procedure } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fakeFetch } from '../../../../../Helpers/FakeFetch.js';

/** The error a refused answer carries. */
interface IRefusal {
  readonly errorType: ScraperErrorTypes;
  readonly errorMessage: string;
}

const HINT = CompanyTypes.OneZero;
const ORIGIN = 'https://example.test';

const PLAIN_CONFIG: IApiDirectCallConfig = {
  flow: 'sms-otp',
  steps: [],
  envelope: {},
  probe: { queryTag: 'customer' },
};

/** A login step: bank error, outcome, classifier, then one required extract. */
const STEP: IPostStep = {
  name: 'login',
  urlTag: 'auth.login',
  body: { shape: {} },
  failIfPresent: ['/error'],
  outcome: {
    codePointer: '/status',
    successCodes: ['0'],
    failureMap: { '7': ScraperErrorTypes.InvalidPassword },
    defaultFailure: ScraperErrorTypes.Generic,
  },
  classify: {
    into: 'branch',
    cases: [
      {
        name: 'otp',
        when: [{ pointer: '/state', equals: 'pending' }],
        captures: { otpId: { pointer: '/id', maxChars: 16 } },
      },
      {
        name: 'locked',
        when: [{ pointer: '/state', equals: 'locked' }],
        fail: ScraperErrorTypes.AccountBlocked,
      },
    ],
  },
  extractsToCarry: { token: '/token' },
};

beforeAll((): void => {
  registerWkUrl('auth.login', HINT, `${ORIGIN}/api/login`);
});

/**
 * Run the login step over the real native mediator against one answer.
 * @param answer - The bank's JSON answer.
 * @returns The step's verdict.
 */
async function runAgainst(answer: JsonValue): Promise<Procedure<ITemplateScope>> {
  const fake = fakeFetch((): Response => Response.json(answer));
  globalThis.fetch = fake.fetchImpl as typeof globalThis.fetch;
  const graphql = {} as unknown as GraphQLFetchStrategy;
  const transport = new HeadlessNativeFetchStrategy(ORIGIN);
  const bus = createApiMediator(HINT, transport, graphql);
  const scope = { carry: {}, creds: {}, config: PLAIN_CONFIG };
  return runStep({ step: STEP, bus, scope, companyId: HINT });
}

describe('answer classifier on the wire', () => {
  const originalFetch = globalThis.fetch;

  afterEach((): void => {
    globalThis.fetch = originalFetch;
  });

  it('writes the case and its captures beside the extracts', async (): Promise<void> => {
    const answer = { status: '0', state: 'pending', id: 'syn-a1', token: 'syn-t' };
    const verdict = await runAgainst(answer);
    const carry = { branch: 'otp', otpId: 'syn-a1', token: 'syn-t' };
    expect(verdict).toMatchObject({ success: true, value: { carry } });
  });

  it.each<[string, JsonValue, IRefusal]>([
    [
      'a bank error before the classifier',
      { error: 'syn-e', status: '0', state: 'odd' },
      { errorType: ScraperErrorTypes.Generic, errorMessage: 'login bank error' },
    ],
    [
      'the outcome before the classifier',
      { status: '7', state: 'odd' },
      { errorType: ScraperErrorTypes.InvalidPassword, errorMessage: 'login outcome 7' },
    ],
    [
      'the classifier before the extracts',
      { status: '0', state: 'odd' },
      { errorType: ScraperErrorTypes.Generic, errorMessage: 'login answer unrecognized' },
    ],
    [
      'a fail case before the extracts',
      { status: '0', state: 'locked' },
      { errorType: ScraperErrorTypes.AccountBlocked, errorMessage: 'login answer locked' },
    ],
  ])('fails on %s', async (_label, answer, refusal): Promise<void> => {
    const verdict = await runAgainst(answer);
    expect(verdict).toMatchObject({ success: false, ...refusal });
  });
});
