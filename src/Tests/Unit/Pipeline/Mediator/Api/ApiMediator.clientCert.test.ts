/**
 * The node:https mediator factory exposes the dynamic client-certificate
 * port only when the bank declares one. The installed certificate is
 * presented to the declared origin and nowhere else; the mocked-transport seam
 * records what each request would present, so no network is touched.
 */

import { CompanyTypes } from '../../../../../Definitions.js';
import { createMtlsHeadlessApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import type { INodeTlsMediatorArgs } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.transport.types.js';
import { literalUrl } from '../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { setMtlsFetchFallback } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/Mtls/MtlsTransport.js';
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

describe('createMtlsHeadlessApiMediator — dynamic client certificate', () => {
  afterEach(() => {
    setMtlsFetchFallback();
  });

  it('exposes no certificate port when none is declared', () => {
    const mediator = createMtlsHeadlessApiMediator(BASE_ARGS);
    expect(mediator.clientCert).toBeUndefined();
  });

  it('exposes the certificate port when a dynamic certificate is declared', () => {
    const mediator = createMtlsHeadlessApiMediator(DYNAMIC_ARGS);
    const installed = mediator.clientCert?.install(DEVICE_PAIR);
    const wasCleared = mediator.clientCert?.clear();
    expect(installed).toEqual(INSTALLED);
    expect(wasCleared).toBe(true);
  });

  it('presents the installed certificate to the declared origin only', async () => {
    const presented = recordPresented();
    const mediator = createMtlsHeadlessApiMediator(DYNAMIC_ARGS);
    mediator.clientCert?.install(DEVICE_PAIR);
    await mediator.apiGet(BANK_URL);
    await mediator.apiGet(OTHER_URL);
    expect(presented).toEqual([{ sha256: DEVICE.sha256 }, false]);
  });

  it('presents nothing before a certificate is installed', async () => {
    const presented = recordPresented();
    const mediator = createMtlsHeadlessApiMediator(DYNAMIC_ARGS);
    await mediator.apiGet(BANK_URL);
    expect(presented).toEqual([false]);
  });
});
