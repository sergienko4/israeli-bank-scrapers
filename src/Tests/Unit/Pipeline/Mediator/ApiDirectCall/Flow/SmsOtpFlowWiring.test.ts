/**
 * Integration tests for the BACKLOG-4 wiring delta: AES body-signature
 * attach, cryptoField OTP encrypt, and the new flow-init expansions
 * (seedCarryFromCreds + derivedCarry). Each case drives runSmsOtpFlow
 * through a stub mediator so the assertions observe what hit the
 * outbound HTTP body and the carry state at flow boundaries.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import ScraperError from '../../../../../../Scrapers/Base/ScraperError.js';
import { runSmsOtpFlow } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/SmsOtpFlow.js';
import type { IApiDirectCallConfig } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/IApiDirectCallConfig.js';
import type { WKUrlGroup } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { type IApiPostCapture, makeStubMediator } from './StubMediator.js';

const BIND_TAG: WKUrlGroup = 'auth.bind';
const ASSERT_TAG: WKUrlGroup = 'auth.assert';
const HINT = CompanyTypes.OneZero;

beforeAll((): void => {
  registerWkUrl(BIND_TAG, HINT, 'https://example.test/api/bind');
  registerWkUrl(ASSERT_TAG, HINT, 'https://example.test/api/assert');
});

/** 32-byte AES key used across the BACKLOG-4 wiring integration cases. */
const FIXT_SIGN_KEY = 'a'.repeat(32);

/**
 * Build one step for the AES + cryptoField fixture.
 * @param i - 1-based step index.
 * @param isLast - True for the final step (extracts the bearer token).
 * @returns Step config.
 */
function buildAesStep(i: number, isLast: boolean): IApiDirectCallConfig['steps'][number] {
  const idx = String(i);
  const pinIvSlot = `carry.pinIv${idx}Hex` as const;
  return {
    name: i === 1 ? 'bind' : 'assertPassword',
    urlTag: i === 1 ? BIND_TAG : ASSERT_TAG,
    body: {
      shape: {
        iv: { $ref: 'carry.ivHex' },
        signature: { $literal: '' },
        pinIv: { $ref: pinIvSlot },
        pin: { $literal: '' },
      },
    },
    preHook: {
      awaitCredsField: 'otpCodeRetriever',
      intoCarryField: 'otpDigitsPlain',
      cryptoField: {
        keyRef: 'carry.otpKey',
        ivRef: pinIvSlot,
        writeTo: '/pin',
        scrubFromCarry: 'otpDigitsPlain',
      },
    },
    extractsToCarry: isLast ? { token: '/access_token' } : { ack: '/ack' },
  };
}

/**
 * Build a baseline AES + cryptoField config covering `stepCount` steps.
 * @param stepCount - Number of steps to emit.
 * @returns Full IApiDirectCallConfig literal.
 */
function makeAesConfigWithCryptoField(stepCount: number): IApiDirectCallConfig {
  const stepIndexes = Array.from({ length: stepCount }, (_unused, k) => k + 1);
  /**
   * Map an index to its step config.
   * @param i - 1-based step index.
   * @returns Step config.
   */
  const toStep = (i: number): IApiDirectCallConfig['steps'][number] =>
    buildAesStep(i, i === stepCount);
  const steps = stepIndexes.map(toStep);
  return {
    flow: 'sms-otp',
    envelope: {},
    probe: {},
    secrets: { signKey: FIXT_SIGN_KEY, pinSuffix: 'p'.repeat(32) },
    seedCarryFromCreds: ['deviceId16Hex'],
    derivedCarry: [
      {
        into: 'otpKey',
        parts: ['carry.deviceId16Hex', 'config.secrets.pinSuffix'],
        separator: '|',
        truncateBytes: 32,
      },
    ],
    signer: {
      algorithm: 'AES-CBC-PKCS7',
      keyRef: 'config.secrets.signKey',
      ivStrategy: 'random-16',
      ivCarrySlot: 'ivHex',
      bodySignatureField: '/signature',
      canonical: {
        parts: ['tsMs', 'deviceId'],
        separator: '|',
        escapeFrom: '|',
        escapeTo: String.raw`\|`,
        sortQueryParams: false,
        clientVersion: '1.0.0',
      },
    },
    steps,
  };
}

/**
 * Synthetic OTP retriever used by the BACKLOG-4 wiring fixtures.
 * @returns Resolved synthetic OTP digits.
 */
function fixtOtpRetriever(): Promise<string> {
  return Promise.resolve('9255');
}

describe('api-direct-call SmsOtpFlow — AES + cryptoField wiring (BACKLOG-4)', () => {
  it('UC-BL4-1: encrypts plaintext into body /pin and attaches /signature', async () => {
    const captures: IApiPostCapture[] = [];
    const config = makeAesConfigWithCryptoField(1);
    const responses = [succeed({ access_token: 'aes-tok' })];
    const bus = makeStubMediator({ responses, captures });
    const result = await runSmsOtpFlow({
      config,
      bus,
      creds: { deviceId16Hex: 'feedfacecafebabe', otpCodeRetriever: fixtOtpRetriever },
      companyId: HINT,
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('AES + cryptoField flow must succeed');
    const body = captures[0].body;
    expect(typeof body.iv).toBe('string');
    expect((body.iv as string).length).toBe(32);
    expect(typeof body.pin).toBe('string');
    expect((body.pin as string).length).toBeGreaterThan(0);
    expect(typeof body.signature).toBe('string');
    expect((body.signature as string).length).toBeGreaterThan(0);
  });

  it('UC-BL4-2: generates a fresh IV per step', async () => {
    const captures: IApiPostCapture[] = [];
    const config = makeAesConfigWithCryptoField(2);
    const responses = [succeed({ ack: 1 }), succeed({ access_token: 'aes-tok-2' })];
    const bus = makeStubMediator({ responses, captures });
    const result = await runSmsOtpFlow({
      config,
      bus,
      creds: { deviceId16Hex: 'feedfacecafebabe', otpCodeRetriever: fixtOtpRetriever },
      companyId: HINT,
    });
    expect(result.success).toBe(true);
    const iv1 = captures[0].body.iv as string;
    const iv2 = captures[1].body.iv as string;
    expect(iv1).toMatch(/^[0-9a-f]{32}$/u);
    expect(iv2).toMatch(/^[0-9a-f]{32}$/u);
    expect(iv1).not.toBe(iv2);
  });
});

describe('api-direct-call SmsOtpFlow — AES wiring fails fast on misconfig', () => {
  it('UC-BL4-3: fails when signer.keyRef points to a missing config path', async () => {
    const captures: IApiPostCapture[] = [];
    const config: IApiDirectCallConfig = {
      flow: 'sms-otp',
      envelope: {},
      probe: {},
      signer: {
        algorithm: 'AES-CBC-PKCS7',
        keyRef: 'config.secrets.missingKey',
        ivStrategy: 'random-16',
        ivCarrySlot: 'ivHex',
        bodySignatureField: '/signature',
        canonical: {
          parts: ['bodyJson'],
          separator: '|',
          escapeFrom: '|',
          escapeTo: String.raw`\|`,
          sortQueryParams: false,
          clientVersion: '1.0.0',
        },
      },
      steps: [
        {
          name: 'getIdToken',
          urlTag: BIND_TAG,
          body: { shape: { x: { $literal: 1 } } },
          extractsToCarry: { token: '/access_token' },
        },
      ],
    };
    const bus = makeStubMediator({ responses: [succeed({ access_token: 't' })], captures });
    const result = await runSmsOtpFlow({ config, bus, creds: {}, companyId: HINT });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('config.secrets.missingKey');
  });

  it('UC-BL4-4: fails when cryptoField keyRef points to a missing carry slot', async () => {
    const captures: IApiPostCapture[] = [];
    const config: IApiDirectCallConfig = {
      flow: 'sms-otp',
      envelope: {},
      probe: {},
      steps: [
        {
          name: 'bind',
          urlTag: BIND_TAG,
          body: {
            shape: {
              pinIv: { $ref: 'carry.pinIvHex' },
              pin: { $literal: '' },
            },
          },
          preHook: {
            awaitCredsField: 'otpCodeRetriever',
            intoCarryField: 'otpDigitsPlain',
            cryptoField: {
              keyRef: 'carry.missingKey',
              ivRef: 'carry.pinIvHex',
              writeTo: '/pin',
              scrubFromCarry: 'otpDigitsPlain',
            },
          },
          extractsToCarry: { token: '/access_token' },
        },
      ],
    };
    const bus = makeStubMediator({ responses: [succeed({ access_token: 't' })], captures });
    const result = await runSmsOtpFlow({
      config,
      bus,
      creds: { otpCodeRetriever: fixtOtpRetriever },
      companyId: HINT,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('missingKey');
  });

  it('UC-BL4-3b: fails when signer.keyRef resolves to a non-string value', async () => {
    const captures: IApiPostCapture[] = [];
    const config: IApiDirectCallConfig = {
      flow: 'sms-otp',
      envelope: {},
      probe: {},
      staticHeaders: { fake: 'header' },
      signer: {
        algorithm: 'AES-CBC-PKCS7',
        keyRef: 'config.staticHeaders',
        ivStrategy: 'random-16',
        ivCarrySlot: 'ivHex',
        bodySignatureField: '/signature',
        canonical: {
          parts: ['bodyJson'],
          separator: '|',
          escapeFrom: '|',
          escapeTo: String.raw`\|`,
          sortQueryParams: false,
          clientVersion: '1.0.0',
        },
      },
      steps: [
        {
          name: 'getIdToken',
          urlTag: BIND_TAG,
          body: { shape: { x: { $literal: 1 } } },
          extractsToCarry: { token: '/access_token' },
        },
      ],
    };
    const bus = makeStubMediator({ responses: [succeed({ access_token: 't' })], captures });
    const result = await runSmsOtpFlow({ config, bus, creds: {}, companyId: HINT });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('did not resolve to a string');
  });

  it('UC-BL4-4b: fails when cryptoField.keyRef resolves to a non-string value', async () => {
    const captures: IApiPostCapture[] = [];
    const config: IApiDirectCallConfig = {
      flow: 'sms-otp',
      envelope: {},
      probe: {},
      staticHeaders: { fake: 'header' },
      steps: [
        {
          name: 'bind',
          urlTag: BIND_TAG,
          body: {
            shape: {
              pinIv: { $ref: 'carry.pinIvHex' },
              pin: { $literal: '' },
            },
          },
          preHook: {
            awaitCredsField: 'otpCodeRetriever',
            intoCarryField: 'otpDigitsPlain',
            cryptoField: {
              keyRef: 'config.staticHeaders' as `config.${string}`,
              ivRef: 'carry.pinIvHex',
              writeTo: '/pin',
              scrubFromCarry: 'otpDigitsPlain',
            },
          },
          extractsToCarry: { token: '/access_token' },
        },
      ],
    };
    const bus = makeStubMediator({ responses: [succeed({ access_token: 't' })], captures });
    const result = await runSmsOtpFlow({
      config,
      bus,
      creds: { otpCodeRetriever: fixtOtpRetriever },
      companyId: HINT,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('did not resolve to a string');
  });

  it('UC-BL4-6: surfaces AES sign failure when signer key length is wrong', async () => {
    const captures: IApiPostCapture[] = [];
    const config: IApiDirectCallConfig = {
      flow: 'sms-otp',
      envelope: {},
      probe: {},
      secrets: { signKey: 'k' },
      signer: {
        algorithm: 'AES-CBC-PKCS7',
        keyRef: 'config.secrets.signKey',
        ivStrategy: 'random-16',
        ivCarrySlot: 'ivHex',
        bodySignatureField: '/signature',
        canonical: {
          parts: ['bodyJson'],
          separator: '|',
          escapeFrom: '|',
          escapeTo: String.raw`\|`,
          sortQueryParams: false,
          clientVersion: '1.0.0',
        },
      },
      steps: [
        {
          name: 'getIdToken',
          urlTag: BIND_TAG,
          body: { shape: { iv: { $ref: 'carry.ivHex' }, signature: { $literal: '' } } },
          extractsToCarry: { token: '/access_token' },
        },
      ],
    };
    const bus = makeStubMediator({ responses: [succeed({ access_token: 't' })], captures });
    const result = await runSmsOtpFlow({ config, bus, creds: {}, companyId: HINT });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('key');
  });

  it('UC-BL4-7: surfaces cryptoField sign failure when otpKey length is wrong', async () => {
    const captures: IApiPostCapture[] = [];
    const config: IApiDirectCallConfig = {
      flow: 'sms-otp',
      envelope: {},
      probe: {},
      secrets: { otpKey: 'k' },
      steps: [
        {
          name: 'bind',
          urlTag: BIND_TAG,
          body: {
            shape: { pinIv: { $ref: 'carry.pinIvHex' }, pin: { $literal: '' } },
          },
          preHook: {
            awaitCredsField: 'otpCodeRetriever',
            intoCarryField: 'otpDigitsPlain',
            cryptoField: {
              keyRef: 'config.secrets.otpKey',
              ivRef: 'carry.pinIvHex',
              writeTo: '/pin',
              scrubFromCarry: 'otpDigitsPlain',
            },
          },
          extractsToCarry: { token: '/access_token' },
        },
      ],
    };
    const bus = makeStubMediator({ responses: [succeed({ access_token: 't' })], captures });
    const result = await runSmsOtpFlow({
      config,
      bus,
      creds: { otpCodeRetriever: fixtOtpRetriever },
      companyId: HINT,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('key');
  });

  it('UC-BL4-8: surfaces attach failure when cryptoField writeTo is malformed', async () => {
    const captures: IApiPostCapture[] = [];
    const config: IApiDirectCallConfig = {
      flow: 'sms-otp',
      envelope: {},
      probe: {},
      secrets: { otpKey: 'o'.repeat(32) },
      steps: [
        {
          name: 'bind',
          urlTag: BIND_TAG,
          body: { shape: { pinIv: { $ref: 'carry.pinIvHex' } } },
          preHook: {
            awaitCredsField: 'otpCodeRetriever',
            intoCarryField: 'otpDigitsPlain',
            cryptoField: {
              keyRef: 'config.secrets.otpKey',
              ivRef: 'carry.pinIvHex',
              writeTo: 'no-leading-slash',
              scrubFromCarry: 'otpDigitsPlain',
            },
          },
          extractsToCarry: { token: '/access_token' },
        },
      ],
    };
    const bus = makeStubMediator({ responses: [succeed({ access_token: 't' })], captures });
    const result = await runSmsOtpFlow({
      config,
      bus,
      creds: { otpCodeRetriever: fixtOtpRetriever },
      companyId: HINT,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('pointer');
  });

  it('UC-BL4-5: runs cryptoField even when signer is absent (pure encrypt step)', async () => {
    const captures: IApiPostCapture[] = [];
    const config: IApiDirectCallConfig = {
      flow: 'sms-otp',
      envelope: {},
      probe: {},
      secrets: { otpKey: 'k'.repeat(32) },
      steps: [
        {
          name: 'bind',
          urlTag: BIND_TAG,
          body: {
            shape: {
              pinIv: { $ref: 'carry.pinIvHex' },
              pin: { $literal: '' },
            },
          },
          preHook: {
            awaitCredsField: 'otpCodeRetriever',
            intoCarryField: 'otpDigitsPlain',
            cryptoField: {
              keyRef: 'config.secrets.otpKey',
              ivRef: 'carry.pinIvHex',
              writeTo: '/pin',
              scrubFromCarry: 'otpDigitsPlain',
            },
          },
          extractsToCarry: { token: '/access_token' },
        },
      ],
    };
    const bus = makeStubMediator({ responses: [succeed({ access_token: 'tok' })], captures });
    const result = await runSmsOtpFlow({
      config,
      bus,
      creds: { otpCodeRetriever: fixtOtpRetriever },
      companyId: HINT,
    });
    expect(result.success).toBe(true);
    const body = captures[0].body;
    expect(typeof body.pin).toBe('string');
    expect((body.pin as string).length).toBeGreaterThan(0);
    expect(body.signature).toBeUndefined();
  });
});
