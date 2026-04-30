/**
 * Unit tests for SmsOtpFlow — the generic orchestrator for the
 * 'sms-otp' flow-kind. Covers: happy 2-step flow with carry
 * threading, step-reduction short-circuit on fail, missing-token
 * extraction fail, and fingerprint/keypair branch presence.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import ScraperError from '../../../../../../Scrapers/Base/ScraperError.js';
import { runSmsOtpFlow } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/SmsOtpFlow.js';
import type { IApiDirectCallConfig } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/IApiDirectCallConfig.js';
import type { WKUrlGroup } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { fail, succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { type IApiPostCapture, makeStubMediator } from './StubMediator.js';

const BIND_TAG: WKUrlGroup = 'auth.bind';
const ASSERT_TAG: WKUrlGroup = 'auth.assert';
const HINT = CompanyTypes.OneZero;

beforeAll((): void => {
  registerWkUrl(BIND_TAG, HINT, 'https://example.test/api/bind');
  registerWkUrl(ASSERT_TAG, HINT, 'https://example.test/api/assert');
});

/**
 * Build a 2-step config: bind captures "challenge" into carry;
 * assert reads carry.challenge via $ref and emits carry.token.
 * @returns Config literal.
 */
function makeConfig(): IApiDirectCallConfig {
  return {
    flow: 'sms-otp',
    envelope: {},
    probe: {},
    fingerprint: {
      shape: {
        metadata: { timestamp: { $ref: 'now' } },
        content: { device_details: { $literal: { os: 'test' } } },
      },
    },
    signer: {
      algorithm: 'ECDSA-P256',
      encoding: 'DER',
      headerName: 'X-Sig',
      schemeTag: 4,
      canonical: {
        parts: ['bodyJson'],
        separator: '%%',
        escapeFrom: '%%',
        escapeTo: String.raw`\%`,
        sortQueryParams: false,
        clientVersion: '9.9.9',
      },
    },
    steps: [
      {
        name: 'bind',
        urlTag: BIND_TAG,
        body: {
          shape: {
            fp: { $ref: 'fingerprint' },
            pub: { $ref: 'keypair.ec.publicKeyBase64' },
          },
        },
        extractsToCarry: { challenge: '/data/challenge' },
      },
      {
        name: 'assertPassword',
        urlTag: ASSERT_TAG,
        body: {
          shape: {
            pass: { $ref: 'creds.password' },
            chal: { $ref: 'carry.challenge' },
          },
        },
        extractsToCarry: { token: '/data/accessToken' },
      },
    ],
  };
}

describe('api-direct-call SmsOtpFlow happy 2-step path', () => {
  it('threads carry through steps and returns the final carry.token', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const responses = [
      succeed({ data: { challenge: 'c1' } }),
      succeed({ data: { accessToken: 'tok-xyz' } }),
    ];
    const bus = makeStubMediator({ responses, captures });
    const result = await runSmsOtpFlow({
      config: makeConfig(),
      bus,
      creds: { password: 'secret' },
      companyId: HINT,
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('flow should succeed');
    expect(result.value.bearer).toBe('tok-xyz');
    expect(captures).toHaveLength(2);
    const assertBody = captures[1].body as { pass: string; chal: string };
    expect(assertBody.pass).toBe('secret');
    expect(assertBody.chal).toBe('c1');
  });
});

describe('api-direct-call SmsOtpFlow step failure short-circuits', () => {
  it('returns first-step fail and does not fire the second step', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const responses = [
      fail(ScraperErrorTypes.Generic, 'bind boom'),
      succeed({ data: { accessToken: 'never' } }),
    ];
    const bus = makeStubMediator({ responses, captures });
    const result = await runSmsOtpFlow({
      config: makeConfig(),
      bus,
      creds: { password: 'secret' },
      companyId: HINT,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toBe('bind boom');
    expect(captures).toHaveLength(1);
  });
});

describe('api-direct-call SmsOtpFlow missing carry.token', () => {
  it('fails when the last step did not populate carry.token', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const config: IApiDirectCallConfig = {
      ...makeConfig(),
      steps: [
        {
          name: 'bind',
          urlTag: BIND_TAG,
          body: { shape: { fp: { $ref: 'fingerprint' } } },
          extractsToCarry: { challenge: '/data/challenge' },
        },
      ],
    };
    const responses = [succeed({ data: { challenge: 'c1' } })];
    const bus = makeStubMediator({ responses, captures });
    const result = await runSmsOtpFlow({
      config,
      bus,
      creds: {},
      companyId: HINT,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('carry.token');
  });
});

describe('api-direct-call SmsOtpFlow no signer + no fingerprint', () => {
  it('runs a single plain step that only reads carry seed', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const config: IApiDirectCallConfig = {
      flow: 'sms-otp',
      envelope: {},
      probe: {},
      steps: [
        {
          name: 'getIdToken',
          urlTag: BIND_TAG,
          body: { shape: { x: { $literal: 1 } } },
          extractsToCarry: { token: '/access_token' },
        },
      ],
    };
    const responses = [succeed({ access_token: 'plain-tok' })];
    const bus = makeStubMediator({ responses, captures });
    const result = await runSmsOtpFlow({
      config,
      bus,
      creds: {},
      companyId: HINT,
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('flow should succeed');
    expect(result.value.bearer).toBe('plain-tok');
    expect(captures[0].extraHeaders).toEqual({});
  });
});
