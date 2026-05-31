/**
 * Integration test for the AES body-signing + cryptoField encryption
 * flow that the post-login envelope banks (class-y) rely on.
 *
 * One end-to-end runStep invocation against a config carrying:
 *   - signer: AES-CBC-PKCS7 with canonical parts [bodyJson, tsMs]
 *   - step.preHook: awaitCredsField → intoCarryField + cryptoField
 *
 * exercises every uncovered hot path in RunStepBodySigning.ts
 * (primeStepCarry → seedCryptoIv → applyCryptoField → encryptAndWrite
 * → writeAtPointer → scrubFromCarry → attachBodySignature → signAndWrite),
 * GenericCanonicalStringBuilder.ts (tsMs + bodyJson resolvers), and
 * the corresponding apply branches in ApiDirectCallActions.ts.
 *
 * Per test-guidlines.md ("integration test over unit test"), the test
 * walks the public runStep API — the helpers are not poked directly.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import { runStep } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.js';
import type {
  IApiDirectCallConfig,
  IStepConfig,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/IApiDirectCallConfig.js';
import type { ITemplateScope } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/RefResolver.js';
import type { WKUrlGroup } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { type IApiPostCapture, makeStubMediator } from './StubMediator.js';

const URL_TAG: WKUrlGroup = 'auth.bind';
const HINT = CompanyTypes.OneZero;

beforeAll((): void => {
  registerWkUrl(URL_TAG, HINT, 'https://example.test/api/login?v=1');
});

/** Realistic 32-byte AES-256 key — string literal stored in config.secrets. */
const SIGN_KEY = 'crypto-integration-test-key-32by';
/** AES-256 key for the cryptoField (separate from the signer key). */
const PIN_KEY = 'crypto-pin-key-32-bytes-exactly!';

/**
 * Build a flow config carrying:
 *   - AES body-pointer signer at `/auth/signature`
 *   - secrets.signKey + secrets.pinKey lookups
 *   - one step whose preHook deposits creds.pin into carry.pin then
 *     encrypts it via cryptoField → body `/auth/pinCipher`.
 * @returns Config literal.
 */
function makeConfig(): IApiDirectCallConfig {
  return {
    flow: 'sms-otp',
    envelope: {},
    secrets: { signKey: SIGN_KEY, pinKey: PIN_KEY },
    signer: {
      algorithm: 'AES-CBC-PKCS7',
      keyRef: 'config.secrets.signKey',
      ivStrategy: 'random-16',
      ivCarrySlot: 'sigIvHex',
      canonical: {
        parts: ['bodyJson', 'tsMs'],
        separator: '|',
        escapeFrom: '|',
        escapeTo: String.raw`\|`,
        sortQueryParams: false,
        clientVersion: '1.0',
      },
      bodySignatureField: '/auth/signature',
    },
    steps: [],
  };
}

/**
 * Build the step config that drives the cryptoField + body-signer flow.
 * @returns Step config.
 */
function makeStep(): IStepConfig {
  return {
    name: 'assertPassword',
    urlTag: URL_TAG,
    body: {
      shape: {
        auth: {
          pinCipher: { $literal: '' },
          signature: { $literal: '' },
        },
        payload: { kind: { $literal: 'login' } },
      },
    },
    preHook: {
      awaitCredsField: 'pin',
      intoCarryField: 'pin',
      cryptoField: {
        keyRef: 'config.secrets.pinKey',
        ivRef: 'carry.pinIvHex',
        writeTo: '/auth/pinCipher',
        scrubFromCarry: 'pin',
      },
    },
    extractsToCarry: { token: '/data/token' },
  };
}

/**
 * Build the template scope — deposits creds.pin into carry under the
 * intoCarryField slot, pre-seeds the cryptoField IV slot, and pins the
 * config under test.
 * @returns Scope.
 */
function makeScope(): ITemplateScope {
  return {
    carry: { pin: '0000', pinIvHex: 'abcdef0123456789abcdef0123456789' },
    creds: { pin: '0000' },
    config: makeConfig(),
  };
}

describe('api-direct-call RunStep — AES body-signer + cryptoField pre-hook', () => {
  it('encrypts the pin into /auth/pinCipher, signs body at /auth/signature', async () => {
    const captures: IApiPostCapture[] = [];
    const responses = [succeed({ data: { token: 'jwt-success' } })];
    const bus = makeStubMediator({ responses, captures });
    const result = await runStep({
      step: makeStep(),
      bus,
      scope: makeScope(),
      companyId: HINT,
    });
    expect(result.success).toBe(true);
    expect(captures).toHaveLength(1);
    const auth = captures[0].body.auth as { pinCipher: unknown; signature: unknown };
    expect(typeof auth.pinCipher).toBe('string');
    expect((auth.pinCipher as string).length).toBeGreaterThan(0);
    expect(typeof auth.signature).toBe('string');
    expect((auth.signature as string).length).toBeGreaterThan(0);
  });

  it('scrubs the plaintext pin from carry after encryption', async () => {
    const captures: IApiPostCapture[] = [];
    const responses = [succeed({ data: { token: 'jwt-success' } })];
    const bus = makeStubMediator({ responses, captures });
    const result = await runStep({
      step: makeStep(),
      bus,
      scope: makeScope(),
      companyId: HINT,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // pin was deposited by makeScope, scrubbed by cryptoField post-encrypt.
      expect(result.value.carry.pin).toBeUndefined();
      // token was extracted from the response into carry.
      expect(result.value.carry.token).toBe('jwt-success');
    }
  });

  it('auto-seeds the cryptoField IV slot when the caller has not pre-seeded it', async () => {
    // primeStepCarry → writeCryptoIvSlot path: when the scope carries
    // no `pinIvHex` slot yet, the runner mints a fresh 16-byte IV hex
    // and writes it into carry before encryption runs. Encrypted output
    // is still well-formed; the seed is observable only through the
    // resulting ciphertext (signed body has /auth/pinCipher populated).
    const captures: IApiPostCapture[] = [];
    const responses = [succeed({ data: { token: 'jwt-success' } })];
    const bus = makeStubMediator({ responses, captures });
    const scopeWithoutIv: ITemplateScope = {
      carry: { pin: '0000' },
      creds: { pin: '0000' },
      config: makeConfig(),
    };
    const result = await runStep({
      step: makeStep(),
      bus,
      scope: scopeWithoutIv,
      companyId: HINT,
    });
    expect(result.success).toBe(true);
    expect(captures).toHaveLength(1);
    const auth = captures[0].body.auth as { pinCipher: unknown };
    expect(typeof auth.pinCipher).toBe('string');
    expect((auth.pinCipher as string).length).toBeGreaterThan(0);
  });
});
