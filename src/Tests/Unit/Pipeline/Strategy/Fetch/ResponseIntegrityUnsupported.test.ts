/**
 * Transports without bounded integrity refuse the policy before any I/O.
 */

import { CompanyTypes } from '../../../../../Definitions.js';
import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import { createMtlsHeadlessApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import { GraphQLFetchStrategy } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/GraphQLFetchStrategy.js';
import { MtlsFetchStrategy } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/Mtls/MtlsFetchStrategy.js';
import { NativeFetchStrategy } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/NativeFetchStrategy.js';

const ORIGIN = 'https://bank.example/';
const OPTS = { extraHeaders: {}, responseIntegrity: { maxBytes: 8 } };

describe('unsupported response integrity', () => {
  it('refuses per-call policies on mTLS, GraphQL and uncapped native fetch', async () => {
    /** Refuses agent creation if the transport is incorrectly invoked. */
    const noAgent = (): never => {
      throw new ScraperError('must not construct an agent');
    };
    const strategies = [
      new MtlsFetchStrategy(ORIGIN, noAgent),
      new NativeFetchStrategy(ORIGIN),
      new GraphQLFetchStrategy(ORIGIN),
    ];
    const checks = strategies.map(async strategy => {
      const get = await strategy.fetchGet(ORIGIN, OPTS);
      const post = await strategy.fetchPost(ORIGIN, {}, OPTS);
      expect(get).toMatchObject({
        success: false,
        errorMessage: 'response integrity unsupported',
      });
      expect(post).toMatchObject({
        success: false,
        errorMessage: 'response integrity unsupported',
      });
    });
    await Promise.all(checks);
  });

  it('refuses unsupported factory defaults before constructing a transport', () => {
    const args = {
      bankHint: CompanyTypes.Leumi,
      identityBaseUrl: ORIGIN,
      graphqlUrl: ORIGIN,
      responseIntegrity: { maxBytes: 8 },
    };
    expect(() => createMtlsHeadlessApiMediator(args)).toThrow('response integrity unsupported');
  });
});
