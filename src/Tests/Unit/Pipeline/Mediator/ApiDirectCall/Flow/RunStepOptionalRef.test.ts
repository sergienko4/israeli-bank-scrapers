/**
 * N49 — an optional ref on the wire. A query-template or body key whose
 * optional carry slot is absent is left out of what the step sends; once the
 * slot is carried, the key goes as a plain ref would send it. The cases drive
 * the real mediator over the headless native transport.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import { createApiMediator } from '../../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import type {
  IApiDirectCallConfig,
  IGetStep,
  IPostStep,
  JsonValueTemplate,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { JsonValue } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Envelope/JsonPointer.js';
import { runStep } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.js';
import { hydrate } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/GenericBodyTemplate.js';
import type { ITemplateScope } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/RefResolver.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import type { GraphQLFetchStrategy } from '../../../../../../Scrapers/Pipeline/Strategy/Fetch/GraphQLFetchStrategy.js';
import { HeadlessNativeFetchStrategy } from '../../../../../../Scrapers/Pipeline/Strategy/Fetch/HeadlessNativeFetchStrategy.js';
import { fail } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fakeFetch, type IFetchFake } from '../../../../../Helpers/FakeFetch.js';

const HINT = CompanyTypes.OneZero;
const ORIGIN = 'https://example.test';
const DID = 'syn-did';

const PLAIN_CONFIG: IApiDirectCallConfig = {
  flow: 'sms-otp',
  steps: [],
  envelope: {},
  probe: { queryTag: 'customer' },
};

const OPTIONAL_DID: JsonValueTemplate = { $ref: 'carry.did', optional: true };

const QUERY_STEP: IGetStep = {
  name: 'identify',
  urlTag: 'auth.bind',
  method: 'GET',
  queryTemplate: { aid: { $literal: 'syn-app' }, did: OPTIONAL_DID },
  extractsToCarry: { token: '/access_token' },
};

const BODY_STEP: IPostStep = {
  name: 'identify',
  urlTag: 'auth.login',
  body: { shape: { user: { $literal: 'syn-user' }, did: OPTIONAL_DID } },
  extractsToCarry: { token: '/access_token' },
};

beforeAll((): void => {
  registerWkUrl('auth.bind', HINT, `${ORIGIN}/api/bind`);
  registerWkUrl('auth.login', HINT, `${ORIGIN}/api/login`);
});

/**
 * Run one step over the real native mediator with a token-returning fetch.
 * @param step - Step under test.
 * @param carry - The step's carry.
 * @returns The fetch fake, for request assertions.
 */
async function runOver(
  step: IGetStep | IPostStep,
  carry: Record<string, JsonValue>,
): Promise<IFetchFake> {
  const fake = fakeFetch((): Response => Response.json({ access_token: 'syn-token' }));
  globalThis.fetch = fake.fetchImpl as typeof globalThis.fetch;
  const graphql = {} as unknown as GraphQLFetchStrategy;
  const transport = new HeadlessNativeFetchStrategy(ORIGIN);
  const bus = createApiMediator(HINT, transport, graphql);
  const scope = { carry, creds: {}, config: PLAIN_CONFIG };
  const result = await runStep({ step, bus, scope, companyId: HINT });
  expect(result).toMatchObject({ success: true });
  return fake;
}

describe('N49 optional ref on the wire', () => {
  const originalFetch = globalThis.fetch;

  afterEach((): void => {
    globalThis.fetch = originalFetch;
  });

  it('propagates a failing optional cookie lookup instead of omitting it', (): void => {
    /**
     * Simulate a cookie source failure, not an absent cookie.
     * @returns The failure the optional ref must preserve.
     */
    const cookie = (): ReturnType<typeof fail> =>
      fail(ScraperErrorTypes.Generic, 'ref cookie.csrfcookie bad');
    const scope: ITemplateScope = { carry: {}, creds: {}, config: PLAIN_CONFIG, cookie };
    const template: JsonValueTemplate = { csrf: { $ref: 'cookie.csrfcookie', optional: true } };
    const result = hydrate(template, scope);
    expect(result).toMatchObject({ success: false, errorMessage: 'ref cookie.csrfcookie bad' });
  });

  it.each([
    ['leaves the query key out without the slot', {}, `${ORIGIN}/api/bind?aid=syn-app`],
    [
      'sends the query key with the slot',
      { did: DID },
      `${ORIGIN}/api/bind?aid=syn-app&did=${DID}`,
    ],
  ])('%s', async (_label, carry: Record<string, JsonValue>, url: string): Promise<void> => {
    const fake = await runOver(QUERY_STEP, carry);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].url).toBe(url);
  });

  it('leaves the body key out without the slot', async (): Promise<void> => {
    const fake = await runOver(BODY_STEP, {});
    expect(fake.calls).toHaveLength(1);
    const sent = JSON.parse(fake.calls[0].init.body as string) as JsonValue;
    expect(sent).toEqual({ user: 'syn-user' });
  });
});
