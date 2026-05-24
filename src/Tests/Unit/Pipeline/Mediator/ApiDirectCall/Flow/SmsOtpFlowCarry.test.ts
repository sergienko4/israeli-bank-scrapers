/**
 * Integration tests for the flow-init carry expansions:
 * seedCarryFromCreds (mirror creds field into carry) and derivedCarry
 * (concat + truncate carry-slot derivation). Each case drives
 * runSmsOtpFlow through a stub mediator so assertions observe the
 * carry state visible to step body templates.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import { runSmsOtpFlow } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/SmsOtpFlow.js';
import type { IApiDirectCallConfig } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/IApiDirectCallConfig.js';
import type { WKUrlGroup } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { type IApiPostCapture, makeStubMediator } from './StubMediator.js';

const BIND_TAG: WKUrlGroup = 'auth.bind';
const HINT = CompanyTypes.OneZero;

beforeAll((): void => {
  registerWkUrl(BIND_TAG, HINT, 'https://example.test/api/bind');
});

describe('api-direct-call SmsOtpFlow — seedCarryFromCreds + derivedCarry', () => {
  it('UC-INI-1: mirrors creds field into carry at flow init', async () => {
    const captures: IApiPostCapture[] = [];
    const config: IApiDirectCallConfig = {
      flow: 'sms-otp',
      envelope: {},
      probe: {},
      seedCarryFromCreds: ['deviceId16Hex'],
      steps: [
        {
          name: 'getIdToken',
          urlTag: BIND_TAG,
          body: { shape: { d: { $ref: 'carry.deviceId16Hex' } } },
          extractsToCarry: { token: '/access_token' },
        },
      ],
    };
    const responses = [succeed({ access_token: 'tok' })];
    const bus = makeStubMediator({ responses, captures });
    const result = await runSmsOtpFlow({
      config,
      bus,
      creds: { deviceId16Hex: 'feedfacecafebabe' },
      companyId: HINT,
    });
    expect(result.success).toBe(true);
    expect(captures[0].body.d).toBe('feedfacecafebabe');
  });

  it('UC-INI-2: fails when seedCarryFromCreds field is missing on creds', async () => {
    const config: IApiDirectCallConfig = {
      flow: 'sms-otp',
      envelope: {},
      probe: {},
      seedCarryFromCreds: ['deviceId16Hex'],
      steps: [
        {
          name: 'getIdToken',
          urlTag: BIND_TAG,
          body: { shape: { x: { $literal: 1 } } },
          extractsToCarry: { token: '/access_token' },
        },
      ],
    };
    const bus = makeStubMediator({ responses: [succeed({ access_token: 't' })], captures: [] });
    const result = await runSmsOtpFlow({ config, bus, creds: {}, companyId: HINT });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('deviceId16Hex');
  });

  it('UC-INI-3: derives carry slot via concat + separator + truncateBytes', async () => {
    const captures: IApiPostCapture[] = [];
    const config: IApiDirectCallConfig = {
      flow: 'sms-otp',
      envelope: {},
      probe: {},
      secrets: { pinSuffix: 'p'.repeat(32) },
      seedCarryFromCreds: ['deviceId16Hex'],
      derivedCarry: [
        {
          into: 'otpKey',
          parts: ['carry.deviceId16Hex', 'config.secrets.pinSuffix'],
          separator: '|',
          truncateBytes: 32,
        },
      ],
      steps: [
        {
          name: 'getIdToken',
          urlTag: BIND_TAG,
          body: { shape: { k: { $ref: 'carry.otpKey' } } },
          extractsToCarry: { token: '/access_token' },
        },
      ],
    };
    const responses = [succeed({ access_token: 'tok' })];
    const bus = makeStubMediator({ responses, captures });
    const result = await runSmsOtpFlow({
      config,
      bus,
      creds: { deviceId16Hex: 'feedfacecafebabe' },
      companyId: HINT,
    });
    expect(result.success).toBe(true);
    const observed = captures[0].body.k as string;
    expect(observed.length).toBe(32);
    const hasExpectedPrefix = observed.startsWith('feedfacecafebabe|');
    expect(hasExpectedPrefix).toBe(true);
  });

  it('UC-INI-4: passes derivedCarry without truncateBytes through verbatim', async () => {
    const captures: IApiPostCapture[] = [];
    const config: IApiDirectCallConfig = {
      flow: 'sms-otp',
      envelope: {},
      probe: {},
      secrets: { suffix: 'abc' },
      seedCarryFromCreds: ['deviceId16Hex'],
      derivedCarry: [
        {
          into: 'joined',
          parts: ['carry.deviceId16Hex', 'config.secrets.suffix'],
          separator: '-',
        },
      ],
      steps: [
        {
          name: 'getIdToken',
          urlTag: BIND_TAG,
          body: { shape: { v: { $ref: 'carry.joined' } } },
          extractsToCarry: { token: '/access_token' },
        },
      ],
    };
    const responses = [succeed({ access_token: 'tok' })];
    const bus = makeStubMediator({ responses, captures });
    const result = await runSmsOtpFlow({
      config,
      bus,
      creds: { deviceId16Hex: 'devid' },
      companyId: HINT,
    });
    expect(result.success).toBe(true);
    expect(captures[0].body.v).toBe('devid-abc');
  });

  it('UC-INI-5: fails when a derivedCarry part references a missing carry slot', async () => {
    const config: IApiDirectCallConfig = {
      flow: 'sms-otp',
      envelope: {},
      probe: {},
      derivedCarry: [
        {
          into: 'derived',
          parts: ['carry.notSeeded'],
        },
      ],
      steps: [
        {
          name: 'getIdToken',
          urlTag: BIND_TAG,
          body: { shape: { x: { $literal: 1 } } },
          extractsToCarry: { token: '/access_token' },
        },
      ],
    };
    const bus = makeStubMediator({ responses: [succeed({ access_token: 't' })], captures: [] });
    const result = await runSmsOtpFlow({ config, bus, creds: {}, companyId: HINT });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('notSeeded');
  });

  it('UC-INI-6: seedCarryFromCreds short-circuits when first of many fields fails', async () => {
    const config: IApiDirectCallConfig = {
      flow: 'sms-otp',
      envelope: {},
      probe: {},
      seedCarryFromCreds: ['missingA', 'missingB', 'missingC'],
      steps: [
        {
          name: 'getIdToken',
          urlTag: BIND_TAG,
          body: { shape: { x: { $literal: 1 } } },
          extractsToCarry: { token: '/access_token' },
        },
      ],
    };
    const bus = makeStubMediator({ responses: [succeed({ access_token: 't' })], captures: [] });
    const result = await runSmsOtpFlow({ config, bus, creds: {}, companyId: HINT });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('missingA');
  });

  it('UC-INI-7: truncateBytes wider than joined value returns the input unchanged', async () => {
    const captures: IApiPostCapture[] = [];
    const config: IApiDirectCallConfig = {
      flow: 'sms-otp',
      envelope: {},
      probe: {},
      secrets: { tag: 'tiny' },
      derivedCarry: [
        {
          into: 'short',
          parts: ['config.secrets.tag'],
          truncateBytes: 999,
        },
      ],
      steps: [
        {
          name: 'getIdToken',
          urlTag: BIND_TAG,
          body: { shape: { v: { $ref: 'carry.short' } } },
          extractsToCarry: { token: '/access_token' },
        },
      ],
    };
    const responses = [succeed({ access_token: 'tok' })];
    const bus = makeStubMediator({ responses, captures });
    const result = await runSmsOtpFlow({ config, bus, creds: {}, companyId: HINT });
    expect(result.success).toBe(true);
    expect(captures[0].body.v).toBe('tiny');
  });

  it('UC-INI-8: derivedCarry short-circuits when first of many parts fails', async () => {
    const config: IApiDirectCallConfig = {
      flow: 'sms-otp',
      envelope: {},
      probe: {},
      secrets: { suffix: 's' },
      derivedCarry: [
        {
          into: 'derived',
          parts: ['carry.missing', 'config.secrets.suffix'],
        },
      ],
      steps: [
        {
          name: 'getIdToken',
          urlTag: BIND_TAG,
          body: { shape: { x: { $literal: 1 } } },
          extractsToCarry: { token: '/access_token' },
        },
      ],
    };
    const bus = makeStubMediator({ responses: [succeed({ access_token: 't' })], captures: [] });
    const result = await runSmsOtpFlow({ config, bus, creds: {}, companyId: HINT });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('missing');
  });

  it('UC-INI-9: derivedCarry short-circuits when first of many derivations fails', async () => {
    const config: IApiDirectCallConfig = {
      flow: 'sms-otp',
      envelope: {},
      probe: {},
      secrets: { suffix: 's' },
      derivedCarry: [
        { into: 'first', parts: ['carry.missingA'] },
        { into: 'second', parts: ['config.secrets.suffix'] },
      ],
      steps: [
        {
          name: 'getIdToken',
          urlTag: BIND_TAG,
          body: { shape: { x: { $literal: 1 } } },
          extractsToCarry: { token: '/access_token' },
        },
      ],
    };
    const bus = makeStubMediator({ responses: [succeed({ access_token: 't' })], captures: [] });
    const result = await runSmsOtpFlow({ config, bus, creds: {}, companyId: HINT });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('missingA');
  });
});
