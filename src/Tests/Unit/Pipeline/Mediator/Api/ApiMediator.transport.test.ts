/**
 * Edge coverage for ApiMediator.transport helpers that the mediator
 * integration tests do not naturally reach: query-string appending onto a
 * URL that already carries a `?`, and the GraphQL transport-failure
 * short-circuit in fireQuery.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import {
  appendQuery,
  fireQuery,
} from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.transport.js';
import type { IFireQueryArgs } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.types.js';
import { fail, isOk, type Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

/**
 * GraphQL query stub that always resolves to a failed procedure.
 * @returns Failed transport procedure.
 */
function failingQuery(): Promise<Procedure<unknown>> {
  const failure = fail(ScraperErrorTypes.Generic, 'graphql transport down');
  return Promise.resolve(failure);
}

/**
 * Build fireQuery args whose GraphQL strategy always fails.
 * @returns Cast fireQuery args with a failing transport.
 */
function argsWithFailingGraphql(): IFireQueryArgs {
  const deps = { graphqlStrategy: { query: failingQuery } };
  const raw = { deps, queryString: 'q', variables: {}, rawAuth: '', extraHeaders: {} };
  return raw as unknown as IFireQueryArgs;
}

describe('ApiMediator.transport.appendQuery (edge)', () => {
  it('joins with & when the url already has a query string', () => {
    const joined = appendQuery('https://x.test/p?a=1', { b: '2' });
    expect(joined).toBe('https://x.test/p?a=1&b=2');
  });

  it('returns the url unchanged when no params are supplied', () => {
    const unchanged = appendQuery('https://x.test/p', {});
    expect(unchanged).toBe('https://x.test/p');
  });
});

describe('ApiMediator.transport.fireQuery (edge)', () => {
  it('propagates a failed GraphQL transport procedure', async () => {
    const args = argsWithFailingGraphql();
    const result = await fireQuery(args);
    const didSucceed = isOk(result);
    expect(didSucceed).toBe(false);
  });
});
