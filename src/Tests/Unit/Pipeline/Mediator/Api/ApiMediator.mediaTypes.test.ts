/**
 * N61 — the headless mediator factory passes bank media-type rules to
 * its native transport.
 */

import { CompanyTypes } from '../../../../../Definitions.js';
import { createHeadlessApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import { registerWkQuery } from '../../../../../Scrapers/Pipeline/Registry/WK/QueriesWK.js';
import { registerWkUrl } from '../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

const HINT = CompanyTypes.OneZero;

/**
 * Answer every request with a text/plain JSON body.
 * @returns The plain-text response.
 */
function answerPlain(): Promise<Response> {
  return Promise.resolve(new Response('{}', { status: 200 }));
}

describe('ApiMediator — bank media types (N61)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach((): void => {
    registerWkUrl('identity.deviceToken', HINT, 'https://id.example/devices/token');
    registerWkQuery('customer', HINT, 'query Customer { me { id } }');
  });
  afterEach((): void => {
    globalThis.fetch = originalFetch;
  });

  it('runs a native mediator under the bank media types', async () => {
    globalThis.fetch = answerPlain;
    const mediator = createHeadlessApiMediator({
      bankHint: HINT,
      identityBaseUrl: 'https://id.example/v1/',
      graphqlUrl: 'https://gql.example/graphql',
      mediaTypes: { json: 'application/json' },
    });
    const result = await mediator.apiGet('identity.deviceToken');
    const message = !isOk(result) && result.errorMessage;
    expect(message).toBe('GET https://id.example/devices/token unexpected media type');
  });

  it('applies the same bank media type to GraphQL answers', async () => {
    globalThis.fetch = answerPlain;
    const mediator = createHeadlessApiMediator({
      bankHint: HINT,
      identityBaseUrl: 'https://id.example/v1/',
      graphqlUrl: 'https://gql.example/graphql',
      mediaTypes: { json: 'application/json' },
    });
    const result = await mediator.apiQuery('customer', {});
    const message = !isOk(result) && result.errorMessage;
    expect(message).toBe('POST https://gql.example/graphql unexpected media type');
  });
});
