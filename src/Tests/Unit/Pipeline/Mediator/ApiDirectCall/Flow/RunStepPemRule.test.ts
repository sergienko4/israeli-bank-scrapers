/**
 * The `pemCertificate` extract rule. The slot text must hold exactly one
 * PEM block, a CERTIFICATE that parses, certifies the private key its
 * `keyRef` resolves to, and is valid now. Anything else fails the step
 * `<step> extract <slot> invalid`, naming no PEM text. The key ref resolves
 * against the step's scope, so a key an earlier step carried is found.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import type {
  IApiDirectCallConfig,
  IExtractRule,
  IStepConfig,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { applyExtractRules } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.extractRules.js';
import { runSmsOtpFlow } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/SmsOtpFlow.js';
import type { ITemplateScope } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/RefResolver.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import type { JsonValue } from '../../../../../../Scrapers/Pipeline/Types/JsonValue.js';
import { succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { issueTestCert } from '../../../../../Helpers/TestCertificate.js';
import { makeStubMediator } from './StubMediator.js';
import { WARM_STEP_TAG } from './WarmStartFixtures.js';

const HINT = CompanyTypes.Yahav;
const STEP_URL = 'https://bank.example/connect/device/register';
const PEM_RULE: IExtractRule = { type: 'string', pemCertificate: { keyRef: 'carry.certKeyPem' } };
const BARE_CONFIG: IApiDirectCallConfig = { flow: 'sms-otp', envelope: {}, steps: [] };
const ISSUED = issueTestCert({ commonName: 'device' });
const OTHER_KEY = issueTestCert({ commonName: 'device' });
const EXPIRED = issueTestCert({
  keyPem: ISSUED.keyPem,
  notBefore: '2020-01-01T00:00:00.000Z',
  notAfter: '2021-01-01T00:00:00.000Z',
});
const NOT_YET_VALID = issueTestCert({
  keyPem: ISSUED.keyPem,
  notBefore: '2049-01-01T00:00:00.000Z',
  notAfter: '2049-12-31T00:00:00.000Z',
});
const GARBAGE_BLOCK = '-----BEGIN CERTIFICATE-----\nbm90IGEgY2VydA==\n-----END CERTIFICATE-----\n';

/** Expected failure for a refused certificate. */
const INVALID = {
  success: false,
  errorType: ScraperErrorTypes.Generic,
  errorMessage: 'register extract certPem invalid',
};

/**
 * A register step carrying `certPem` under the PEM rule.
 * @returns Step config.
 */
function registerStep(): IStepConfig {
  return {
    name: 'register',
    urlTag: WARM_STEP_TAG,
    body: { shape: {} },
    extractsToCarry: { certPem: '/certPem' },
    extractRules: { certPem: PEM_RULE },
  };
}

/**
 * Rule one extracted certificate text against a carried key.
 * @param text - The extracted `certPem` value.
 * @param keyPem - The key the scope carries, or false for none.
 * @returns The ruled slots, or a failure.
 */
function ruleCert(text: JsonValue, keyPem: string | false): unknown {
  const carried: Record<string, JsonValue> = keyPem === false ? {} : { certKeyPem: keyPem };
  const scope: ITemplateScope = { carry: carried, creds: {}, config: BARE_CONFIG };
  const step = registerStep();
  const carry = { certPem: text };
  return applyExtractRules({ step, resp: {}, carry, stepUrl: STEP_URL, scope });
}

describe('applyExtractRules — pemCertificate', () => {
  it('keeps a current certificate of the carried key', () => {
    const ruled = ruleCert(ISSUED.certPem, ISSUED.keyPem);
    expect(ruled).toEqual({ success: true, value: { certPem: ISSUED.certPem } });
  });

  it.each<[string, JsonValue, string | false]>([
    ['two certificate blocks', `${ISSUED.certPem}${ISSUED.certPem}`, ISSUED.keyPem],
    ['a certificate beside a private key', `${ISSUED.certPem}${ISSUED.keyPem}`, ISSUED.keyPem],
    ['a certificate of another key', OTHER_KEY.certPem, ISSUED.keyPem],
    ['an expired certificate', EXPIRED.certPem, ISSUED.keyPem],
    ['a certificate not yet valid', NOT_YET_VALID.certPem, ISSUED.keyPem],
    ['garbage inside a certificate block', GARBAGE_BLOCK, ISSUED.keyPem],
    ['text with no PEM block', 'not a certificate', ISSUED.keyPem],
    ['an unresolved key ref', ISSUED.certPem, false],
    ['a key that does not parse', ISSUED.certPem, 'not a key'],
  ])('fails %s, naming no PEM text', (_label, text, keyPem) => {
    const ruled = ruleCert(text, keyPem);
    expect(ruled).toMatchObject(INVALID);
    const reported = JSON.stringify(ruled);
    expect(reported).not.toContain('-----BEGIN');
  });
});

describe('SmsOtpFlow with a pemCertificate rule', () => {
  const keyStep: IStepConfig = {
    name: 'bind',
    urlTag: WARM_STEP_TAG,
    body: { shape: {} },
    extractsToCarry: { certKeyPem: '/key' },
  };
  const certStep: IStepConfig = {
    ...registerStep(),
    extractsToCarry: { certPem: '/certPem', token: '/token' },
  };
  const config: IApiDirectCallConfig = {
    flow: 'sms-otp',
    envelope: {},
    steps: [keyStep, certStep],
  };

  beforeAll((): void => {
    registerWkUrl(WARM_STEP_TAG, HINT, STEP_URL);
  });

  /**
   * Run the flow: the first step carries the key, the second the certificate.
   * @param certPem - The certificate the second step answers with.
   * @returns The flow result.
   */
  async function runWith(certPem: string): Promise<unknown> {
    const responses = [succeed({ key: ISSUED.keyPem }), succeed({ certPem, token: 'session' })];
    const bus = makeStubMediator({ responses, captures: [] });
    return runSmsOtpFlow({ config, bus, creds: {}, companyId: HINT });
  }

  it('resolves the key ref against the carry of an earlier step', async () => {
    const result = await runWith(ISSUED.certPem);
    expect(result).toMatchObject({ success: true });
  });

  it('fails the step on a certificate of another key', async () => {
    const result = await runWith(OTHER_KEY.certPem);
    expect(result).toMatchObject(INVALID);
  });
});
