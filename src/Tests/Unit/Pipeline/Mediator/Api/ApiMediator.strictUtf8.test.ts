/**
 * The HTTP mediator factory hands the bank's `strictUtf8` to its
 * native transport, so every call on that bank decodes its answer strictly.
 */

import { CompanyTypes } from '../../../../../Definitions.js';
import { createNativeApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import {
  registerWkQuery,
  resetWkRegistryForTest as resetWkQueriesForTest,
} from '../../../../../Scrapers/Pipeline/Registry/WK/QueriesWK.js';
import {
  registerWkUrl,
  resetWkRegistryForTest as resetWkUrlsForTest,
} from '../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

const HINT = CompanyTypes.OneZero;

/**
 * Answer every request with JSON whose one string holds the byte 0xff.
 * @returns A 200 response that is not UTF-8.
 */
function answerLatin1(): Promise<Response> {
  const body = Uint8Array.of(0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d);
  const response = new Response(body, { status: 200 });
  return Promise.resolve(response);
}

describe('ApiMediator — strict UTF-8 bank', () => {
  const originalFetch = globalThis.fetch;

  beforeEach((): void => {
    resetWkUrlsForTest();
    resetWkQueriesForTest();
    registerWkUrl('identity.deviceToken', HINT, 'https://id.example/devices/token');
    registerWkQuery('customer', HINT, 'query Customer { me { id } }');
  });
  afterEach((): void => {
    globalThis.fetch = originalFetch;
  });

  it('runs a native mediator under the bank strict UTF-8 decoding', async () => {
    globalThis.fetch = answerLatin1;
    const mediator = createNativeApiMediator({
      bankHint: HINT,
      identityBaseUrl: 'https://id.example/v1/',
      graphqlUrl: 'https://gql.example/graphql',
      strictUtf8: true,
    });
    const result = await mediator.apiGet('identity.deviceToken');
    const message = !isOk(result) && result.errorMessage;
    expect(message).toBe('GET https://id.example/devices/token body not utf-8');
  });

  it('applies the same bank strict UTF-8 decoding to GraphQL answers', async () => {
    globalThis.fetch = answerLatin1;
    const mediator = createNativeApiMediator({
      bankHint: HINT,
      identityBaseUrl: 'https://id.example/v1/',
      graphqlUrl: 'https://gql.example/graphql',
      strictUtf8: true,
    });
    const result = await mediator.apiQuery('customer', {});
    const message = !isOk(result) && result.errorMessage;
    expect(message).toBe('POST https://gql.example/graphql body not utf-8');
  });
});
