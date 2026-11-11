/**
 * N25b — a step's `pkcs10-csr` generator signs a PKCS#10 request with the
 * key its `keyRef` names and writes it, base64url, to `into`. Generators run
 * in order, so it can sign with the key an earlier `rsa-key` generator made
 * in the same step. Its subject values hydrate like body values; one that is
 * not text, a key it cannot read, or a DC that is not ASCII fails the step
 * `<step> generate pkcs10-csr failed` before any request.
 */

import { createPrivateKey, createPublicKey, verify } from 'node:crypto';

import { CompanyTypes } from '../../../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import type {
  IApiDirectCallConfig,
  ICarryGenerator,
  ICsrSubjectEntry,
  IStepConfig,
  RefToken,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { runSmsOtpFlow } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/Lifecycle/SmsOtpFlow.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { type IApiPostCapture, makeStubMediator } from './StubMediator.js';
import { WARM_STEP_TAG } from './WarmStartFixtures.js';

const HINT = CompanyTypes.OneZero;
const STEP_URL = 'https://bank.example/connect/device/register';
const CREDS = { num: '123456', nationalID: '012345678' };

const RSA_KEY: ICarryGenerator = { kind: 'rsa-key', bits: 2048, keyInto: 'certKeyPem' };

/** O, DC and a CN joined from two credentials. */
const SUBJECT: readonly ICsrSubjectEntry[] = [
  { attr: 'O', value: { $literal: 'Example Bank' } },
  { attr: 'DC', value: { $literal: 'IsraeliBankScrapers' } },
  { attr: 'CN', value: { $join: { parts: ['creds.num', { literal: '-' }, 'creds.nationalID'] } } },
];

/**
 * A CSR generator writing into `csr`.
 * @param subject - Subject entries.
 * @param keyRef - Signing key ref.
 * @returns Generator config.
 */
function csrOf(
  subject: readonly ICsrSubjectEntry[] = SUBJECT,
  keyRef: RefToken = 'carry.certKeyPem',
): ICarryGenerator {
  return { kind: 'pkcs10-csr', keyRef, subject, into: 'csr' };
}

/** What one run of the register step did. */
interface IRunTrace {
  readonly result: Awaited<ReturnType<typeof runSmsOtpFlow>>;
  readonly captures: IApiPostCapture[];
}

/**
 * Run one register step with the given generators.
 * @param generate - The step's generators.
 * @returns The flow result and the requests sent.
 */
async function runWith(generate: readonly ICarryGenerator[]): Promise<IRunTrace> {
  const captures: IApiPostCapture[] = [];
  const bus = makeStubMediator({ responses: [succeed({ token: 't' })], captures });
  const step: IStepConfig = {
    name: 'register',
    urlTag: WARM_STEP_TAG,
    generate,
    body: { shape: { csr: { $ref: 'carry.csr' } } },
    extractsToCarry: { token: '/token' },
  };
  const config: IApiDirectCallConfig = { flow: 'sms-otp', envelope: {}, steps: [step] };
  const result = await runSmsOtpFlow({ config, bus, creds: CREDS, companyId: HINT });
  return { result, captures };
}

/**
 * The request info and signature of a base64url CSR (short-form outer header).
 * @param csr - base64url DER.
 * @returns Signed bytes and the signature.
 */
function signedParts(csr: string): { readonly info: Buffer; readonly signature: Buffer } {
  const der = Buffer.from(csr, 'base64url');
  const infoStart = 2 + (der[1] & 0x7f);
  const infoLength = der.readUInt16BE(infoStart + 2);
  const info = der.subarray(infoStart, infoStart + 4 + infoLength);
  const signature = der.subarray(der.length - 256);
  return { info, signature };
}

describe('SmsOtpFlow — pkcs10-csr generator (N25b)', () => {
  beforeAll((): void => {
    registerWkUrl(WARM_STEP_TAG, HINT, STEP_URL);
  });

  it('signs with the key an earlier generator made and sends the request', async () => {
    const run = await runWith([RSA_KEY, csrOf()]);
    if (!run.result.success) throw new TypeError(run.result.errorMessage);
    const carry = run.result.value.carrySnapshot;
    const csr = carry.csr as string;
    expect(run.captures[0].body).toEqual({ csr });
    const privateKey = createPrivateKey(carry.certKeyPem as string);
    const publicKey = createPublicKey(privateKey);
    const parts = signedParts(csr);
    const isValid = verify('RSA-SHA1', parts.info, publicKey, parts.signature);
    expect(isValid).toBe(true);
    const cn = Buffer.from('123456-012345678');
    const hasCommonName = parts.info.includes(cn);
    expect(hasCommonName).toBe(true);
  });

  it.each<[string, readonly ICarryGenerator[]]>([
    ['no key in carry', [csrOf()]],
    ['a key that is not a PEM', [csrOf(SUBJECT, 'creds.num')]],
    ['a subject value that is not text', [RSA_KEY, csrOf([{ attr: 'O', value: { $literal: 5 } }])]],
    ['a DC that is not ASCII', [RSA_KEY, csrOf([{ attr: 'DC', value: { $literal: 'מחשב' } }])]],
  ])('fails the step before any request for %s', async (_label, generate) => {
    const run = await runWith(generate);
    expect(run.result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: 'register generate pkcs10-csr failed',
    });
    expect(run.captures).toHaveLength(0);
  });
});
