/**
 * Additional branch coverage for SmsOtpFlow — exercises preHook (OTP
 * callback), warm-start startStepIndex + initialCarry, longTermToken
 * extraction via warmStart.carryField, and preHook failure paths.
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

const BRANCH_TAG: WKUrlGroup = 'auth.bind';
const HINT = CompanyTypes.OneZero;

beforeAll((): void => {
  registerWkUrl(BRANCH_TAG, HINT, 'https://example.test/api/smsotp-branch');
});

/**
 * Build a single-step config that reads carry.otpCode via $ref and
 * emits carry.token. The step's preHook awaits creds.otpCodeRetriever
 * and deposits the result into carry.otpCode.
 * @returns Config literal.
 */
function makeHookedConfig(): IApiDirectCallConfig {
  return {
    flow: 'sms-otp',
    envelope: {},
    probe: {},
    steps: [
      {
        name: 'assertOtp',
        urlTag: BRANCH_TAG,
        preHook: {
          awaitCredsField: 'otpCodeRetriever',
          intoCarryField: 'otpCode',
        },
        body: { shape: { otp: { $ref: 'carry.otpCode' } } },
        extractsToCarry: { token: '/access_token' },
      },
    ],
  };
}

describe('SmsOtpFlow preHook OTP retrieval', () => {
  it('awaits creds retriever, seeds carry.otpCode, and fires with the value', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const responses = [succeed({ access_token: 'post-otp-tok' })];
    const bus = makeStubMediator({ responses, captures });
    /**
     * Constant OTP retriever used by the happy-path preHook test.
     * @returns OTP code string.
     */
    const retriever = async (): Promise<string> => {
      await Promise.resolve();
      return '123456';
    };
    const result = await runSmsOtpFlow({
      config: makeHookedConfig(),
      bus,
      creds: { otpCodeRetriever: retriever },
      companyId: HINT,
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('flow should succeed');
    expect(result.value.bearer).toBe('post-otp-tok');
    expect(captures).toHaveLength(1);
    expect(captures[0].body).toEqual({ otp: '123456' });
  });

  it('fails when creds[awaitCredsField] is not a function', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const bus = makeStubMediator({ responses: [], captures });
    const result = await runSmsOtpFlow({
      config: makeHookedConfig(),
      bus,
      creds: { otpCodeRetriever: 'not-a-fn' as unknown as () => Promise<string> },
      companyId: HINT,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('is not a function');
    expect(captures).toHaveLength(0);
  });

  it('fails when creds retriever returns a non-string value', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const bus = makeStubMediator({ responses: [], captures });
    /**
     * Retriever that returns a non-string (exercises the type guard).
     * @returns Number 42, deliberately wrong shape.
     */
    const badRetriever = async (): Promise<unknown> => {
      await Promise.resolve();
      return 42;
    };
    const result = await runSmsOtpFlow({
      config: makeHookedConfig(),
      bus,
      creds: { otpCodeRetriever: badRetriever as unknown as () => Promise<string> },
      companyId: HINT,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('did not return a string');
    expect(captures).toHaveLength(0);
  });

  it('wraps thrown errors from creds retriever with preHook prefix', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const bus = makeStubMediator({ responses: [], captures });
    /**
     * Retriever that always throws (exercises the try/catch path).
     * @returns Never returns (throws).
     */
    const throwing = async (): Promise<string> => {
      await Promise.resolve();
      throw new ScraperError('otp boom');
    };
    const result = await runSmsOtpFlow({
      config: makeHookedConfig(),
      bus,
      creds: { otpCodeRetriever: throwing },
      companyId: HINT,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('threw:');
  });
});

describe('SmsOtpFlow warm-start', () => {
  it('honours startStepIndex + initialCarry and only runs remaining steps', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const responses = [succeed({ access_token: 'warm-flow-tok' })];
    const bus = makeStubMediator({ responses, captures });
    const cfg: IApiDirectCallConfig = {
      flow: 'sms-otp',
      envelope: {},
      probe: {},
      warmStart: { credsField: 'stored', carryField: 'token', fromStepIndex: 1 },
      steps: [
        {
          name: 'bind',
          urlTag: BRANCH_TAG,
          body: { shape: {} },
          extractsToCarry: { stored: '/x' },
        },
        {
          name: 'assertOtp',
          urlTag: BRANCH_TAG,
          body: { shape: { sid: { $ref: 'carry.sessionId' } } },
          extractsToCarry: { token: '/access_token' },
        },
      ],
    };
    const result = await runSmsOtpFlow({
      config: cfg,
      bus,
      creds: {},
      companyId: HINT,
      initialCarry: { sessionId: 'prev-session' },
      startStepIndex: 1,
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('warm-start flow should succeed');
    expect(captures).toHaveLength(1);
    expect(captures[0].body).toEqual({ sid: 'prev-session' });
    expect(result.value.longTermToken).toBe('warm-flow-tok');
  });

  it('returns empty-string longTermToken when warmStart is not configured', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const responses = [succeed({ access_token: 'cold-tok' })];
    const bus = makeStubMediator({ responses, captures });
    const cfg: IApiDirectCallConfig = {
      flow: 'sms-otp',
      envelope: {},
      probe: {},
      steps: [
        {
          name: 'getIdToken',
          urlTag: BRANCH_TAG,
          body: { shape: {} },
          extractsToCarry: { token: '/access_token' },
        },
      ],
    };
    const result = await runSmsOtpFlow({
      config: cfg,
      bus,
      creds: {},
      companyId: HINT,
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('cold flow should succeed');
    expect(result.value.longTermToken).toBe('');
  });
});

describe('SmsOtpFlow longTermToken edge cases', () => {
  it('returns empty longTermToken when warmStart carryField holds non-string', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    // Step extracts carry.token (string, bearer) AND a non-string value under the warmStart field.
    const responses = [succeed({ access_token: 'bt', numeric: 12345 })];
    const bus = makeStubMediator({ responses, captures });
    const cfg: IApiDirectCallConfig = {
      flow: 'sms-otp',
      envelope: {},
      probe: {},
      warmStart: { credsField: 'stored', carryField: 'numericField', fromStepIndex: 1 },
      steps: [
        {
          name: 'getIdToken',
          urlTag: BRANCH_TAG,
          body: { shape: {} },
          extractsToCarry: { token: '/access_token', numericField: '/numeric' },
        },
      ],
    };
    const result = await runSmsOtpFlow({ config: cfg, bus, creds: {}, companyId: HINT });
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('flow should succeed');
    expect(result.value.bearer).toBe('bt');
    expect(result.value.longTermToken).toBe('');
  });
});

describe('SmsOtpFlow fingerprint failure propagation', () => {
  it('propagates fingerprint-build failure before step iteration', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const bus = makeStubMediator({ responses: [], captures });
    const cfg: IApiDirectCallConfig = {
      flow: 'sms-otp',
      envelope: {},
      probe: {},
      fingerprint: {
        shape: { missing: { $ref: 'carry.absent' } },
      },
      steps: [
        {
          name: 'getIdToken',
          urlTag: BRANCH_TAG,
          body: { shape: {} },
          extractsToCarry: { token: '/access_token' },
        },
      ],
    };
    const result = await runSmsOtpFlow({ config: cfg, bus, creds: {}, companyId: HINT });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('carry.absent');
    expect(captures).toHaveLength(0);
  });

  it('propagates transport failure verbatim without setting up longTermToken', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const responses = [fail(ScraperErrorTypes.Generic, 'transport wipe')];
    const bus = makeStubMediator({ responses, captures });
    const cfg: IApiDirectCallConfig = {
      flow: 'sms-otp',
      envelope: {},
      probe: {},
      steps: [
        {
          name: 'getIdToken',
          urlTag: BRANCH_TAG,
          body: { shape: {} },
          extractsToCarry: { token: '/access_token' },
        },
      ],
    };
    const result = await runSmsOtpFlow({ config: cfg, bus, creds: {}, companyId: HINT });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toBe('transport wipe');
  });
});
