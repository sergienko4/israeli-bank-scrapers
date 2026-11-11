/**
 * A step naming `clientCert` resolves its key and certificate refs and
 * installs the pair through the bus's certificate port before its request,
 * so that request and every later one to the bank origin present it. A bus
 * without the port, a non-string ref or a pair that does not match fails the
 * step before any request, naming no secret.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import { createMtlsHeadlessApiMediator } from '../../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import type { INodeTlsMediatorArgs } from '../../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.transport.types.js';
import type {
  IApiDirectCallConfig,
  IPostStep,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { JsonValue } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Envelope/JsonPointer.js';
import { runStep } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/Lifecycle/RunStep.js';
import type { ITemplateScope } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/RefResolver.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { setMtlsFetchFallback } from '../../../../../../Scrapers/Pipeline/Strategy/Fetch/Mtls/MtlsTransport.js';
import type { ITokenBus } from '../../../../../../Scrapers/Pipeline/Types/Domain/TokenBus.js';
import { issueTestCert } from '../../../../../Helpers/TestCertificate.js';
import { recordPresented } from '../../../Strategy/Fetch/Mtls/ClientCertTestServer.js';

const HINT = CompanyTypes.Yahav;
const ORIGIN = 'https://bank.example';

const BASE_ARGS: INodeTlsMediatorArgs = {
  bankHint: HINT,
  identityBaseUrl: `${ORIGIN}/`,
  graphqlUrl: `${ORIGIN}/graphql`,
};

const DYNAMIC_ARGS: INodeTlsMediatorArgs = {
  ...BASE_ARGS,
  clientCert: { mode: 'dynamic', origin: ORIGIN },
};

const PLAIN_CONFIG: IApiDirectCallConfig = { flow: 'sms-otp', steps: [], envelope: {} };

const REGISTER_STEP: IPostStep = {
  name: 'register',
  urlTag: 'auth.bind',
  body: { shape: {} },
  clientCert: { key: 'carry.certKeyPem', cert: 'carry.certPem' },
  extractsToCarry: {},
};

const NEXT_STEP: IPostStep = {
  name: 'login',
  urlTag: 'auth.login',
  body: { shape: {} },
  extractsToCarry: {},
};

const DEVICE = issueTestCert({ commonName: 'device' });
const OTHER = issueTestCert({ commonName: 'other' });

beforeAll((): void => {
  registerWkUrl('auth.bind', HINT, `${ORIGIN}/register`);
  registerWkUrl('auth.login', HINT, `${ORIGIN}/next`);
});

/**
 * Template scope holding the certificate slots.
 * @param certKeyPem - Value of `carry.certKeyPem`.
 * @param certPem - Value of `carry.certPem`.
 * @returns Template scope.
 */
function scopeWith(certKeyPem: JsonValue, certPem: JsonValue): ITemplateScope {
  const carry = { certKeyPem, certPem };
  return { carry, creds: {}, config: PLAIN_CONFIG, keypair: undefined };
}

/**
 * Run the register step on a bus with the given scope.
 * @param bus - Token bus.
 * @param scope - Template scope.
 * @returns The step result.
 */
function runRegister(bus: ITokenBus, scope: ITemplateScope): ReturnType<typeof runStep> {
  return runStep({ step: REGISTER_STEP, bus, scope, companyId: HINT });
}

describe('step client certificate', () => {
  afterEach((): void => {
    setMtlsFetchFallback();
  });

  it('installs the pair before the step request and keeps it for later steps', async () => {
    const presented = recordPresented();
    const bus = createMtlsHeadlessApiMediator(DYNAMIC_ARGS);
    const scope = scopeWith(DEVICE.keyPem, DEVICE.certPem);
    const first = await runRegister(bus, scope);
    const nextScope = first.success ? first.value : scope;
    const next = await runStep({ step: NEXT_STEP, bus, scope: nextScope, companyId: HINT });
    const device = { sha256: DEVICE.sha256 };
    expect(first.success && next.success).toBe(true);
    expect(presented).toEqual([device, device]);
  });

  it('fails unsupported on a bus without the certificate port, sending nothing', async () => {
    const presented = recordPresented();
    const bus = createMtlsHeadlessApiMediator(BASE_ARGS);
    const scope = scopeWith(DEVICE.keyPem, DEVICE.certPem);
    const result = await runRegister(bus, scope);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: 'register client certificate unsupported',
    });
    expect(presented).toEqual([]);
  });

  it.each<[string, JsonValue, JsonValue]>([
    ['a non-string key', 42, DEVICE.certPem],
    ['a non-string certificate', DEVICE.keyPem, null],
    ['a key the certificate does not certify', OTHER.keyPem, DEVICE.certPem],
    ['garbage PEM', 'not a key', 'not a cert'],
  ])('fails invalid for %s, sending nothing', async (_label, key, cert) => {
    const presented = recordPresented();
    const bus = createMtlsHeadlessApiMediator(DYNAMIC_ARGS);
    const scope = scopeWith(key, cert);
    const result = await runRegister(bus, scope);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: 'register client certificate invalid',
    });
    expect(presented).toEqual([]);
  });

  it('a refused pair keeps the certificate installed by an earlier step', async () => {
    const presented = recordPresented();
    const bus = createMtlsHeadlessApiMediator(DYNAMIC_ARGS);
    const deviceScope = scopeWith(DEVICE.keyPem, DEVICE.certPem);
    const refusedScope = scopeWith(OTHER.keyPem, DEVICE.certPem);
    await runRegister(bus, deviceScope);
    const refused = await runRegister(bus, refusedScope);
    await runStep({ step: NEXT_STEP, bus, scope: refusedScope, companyId: HINT });
    expect(refused.success).toBe(false);
    const device = { sha256: DEVICE.sha256 };
    expect(presented).toEqual([device, device]);
  });
});
