/**
 * The node:https mediator factory exposes the dynamic client-certificate
 * port only when the bank declares one. The installed certificate is
 * presented to the declared origin and nowhere else; the mocked-transport seam
 * records what each request would present, so no network is touched.
 */

import { CompanyTypes } from '../../../../../Definitions.js';
import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import { createMtlsApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import type { INodeTlsMediatorArgs } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.transport.types.js';
import {
  registerWkQuery,
  resetWkRegistryForTest as resetWkQueriesForTest,
} from '../../../../../Scrapers/Pipeline/Registry/WK/QueriesWK.js';
import { literalUrl } from '../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import type { ICertBundle } from '../../../../../Scrapers/Pipeline/Types/Domain/CertBundle.js';
import type { IClientCertPair } from '../../../../../Scrapers/Pipeline/Types/Domain/ClientCertControl.js';
import { succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { issueTestCert } from '../../../../Helpers/TestCertificate.js';
import { recordPresented } from '../../Strategy/Fetch/Mtls/ClientCertTestServer.js';

const BANK_ORIGIN = 'https://identity.bank.example';
const BANK_URL = literalUrl(`${BANK_ORIGIN}/v1/me`);
const OTHER_URL = literalUrl('https://elsewhere.example/me');

const BASE_ARGS: INodeTlsMediatorArgs = {
  bankHint: CompanyTypes.Yahav,
  identityBaseUrl: `${BANK_ORIGIN}/v1/`,
  graphqlUrl: `${BANK_ORIGIN}/graphql`,
};

const DYNAMIC_ARGS: INodeTlsMediatorArgs = {
  ...BASE_ARGS,
  clientCert: { mode: 'dynamic', origin: BANK_ORIGIN },
};

const DEVICE = issueTestCert({ commonName: 'device' });
const DEVICE_PAIR: IClientCertPair = { key: DEVICE.keyPem, cert: DEVICE.certPem };
const INSTALLED = succeed(true);

describe('createMtlsApiMediator — dynamic client certificate', () => {
  afterEach(() => {
    resetWkQueriesForTest();
  });

  it('exposes no certificate port when none is declared', () => {
    const mediator = createMtlsApiMediator(BASE_ARGS);
    expect(mediator.clientCert).toBeUndefined();
  });

  it('exposes the certificate port when a dynamic certificate is declared', () => {
    const mediator = createMtlsApiMediator(DYNAMIC_ARGS);
    const installed = mediator.clientCert?.install(DEVICE_PAIR);
    const wasCleared = mediator.clientCert?.clear();
    expect(installed).toEqual(INSTALLED);
    expect(wasCleared).toBe(true);
  });

  it('presents the installed certificate to the declared origin only', async () => {
    const { presented, fallback } = recordPresented();
    const mediator = createMtlsApiMediator({ ...DYNAMIC_ARGS, mtls: { fallback } });
    mediator.clientCert?.install(DEVICE_PAIR);
    await mediator.apiGet(BANK_URL);
    await mediator.apiGet(OTHER_URL);
    expect(presented).toEqual([{ sha256: DEVICE.sha256 }, false]);
  });

  it('presents nothing before a certificate is installed', async () => {
    const { presented, fallback } = recordPresented();
    const mediator = createMtlsApiMediator({ ...DYNAMIC_ARGS, mtls: { fallback } });
    await mediator.apiGet(BANK_URL);
    expect(presented).toEqual([false]);
  });
});

describe('createMtlsApiMediator — static client certificate', () => {
  afterEach(() => {
    resetWkQueriesForTest();
  });

  it('fails fast when a certificate is required without a resolver', () => {
    const { presented } = recordPresented();
    /**
     * Build a node:https mediator that requires a certificate but declares
     * no resolver, as a bank config with a missing staticClientCert would.
     * @returns Never; construction throws.
     */
    const createWithoutResolver = (): ReturnType<typeof createMtlsApiMediator> =>
      createMtlsApiMediator({ ...BASE_ARGS, requiresClientCert: true });
    expect(createWithoutResolver).toThrow(ScraperError);
    expect(createWithoutResolver).toThrow(/requiresClientCert set without a certificate resolver/);
    expect(presented).toEqual([]);
  });

  it('presents the injected static certificate to identity and GraphQL calls', async () => {
    const { presented, fallback } = recordPresented();
    registerWkQuery('customer', CompanyTypes.Yahav, 'query Customer { me { id } }');
    let resolved = 0;
    /**
     * Count transport resolutions and answer with the device certificate.
     * @returns The certificate bundle the transport should present.
     */
    const resolveStaticCert = (): ICertBundle => {
      resolved += 1;
      return { cert: DEVICE.certPem, key: DEVICE.keyPem };
    };
    const mediator = createMtlsApiMediator({
      ...BASE_ARGS,
      requiresClientCert: true,
      staticClientCert: resolveStaticCert,
      mtls: { fallback },
    });
    await mediator.apiGet(BANK_URL);
    await mediator.apiQuery('customer', {});
    expect(resolved).toBe(1);
    expect(presented).toEqual([{ sha256: DEVICE.sha256 }, { sha256: DEVICE.sha256 }]);
  });
});
