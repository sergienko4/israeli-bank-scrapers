/**
 * Unit tests for Flow/RunStep.outcome — the step outcome policy that judges a
 * login step's 2xx body before its extracts run.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import type { ScraperCredentials } from '../../../../../../Scrapers/Base/Interface.js';
import ScraperError from '../../../../../../Scrapers/Base/ScraperError.js';
import { buildResolverFromStrategy } from '../../../../../../Scrapers/Pipeline/Mediator/Api/TokenResolverBuilder.js';
import type {
  IApiDirectCallConfig,
  IStepConfig,
  IStepOutcome,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { judgeStepOutcome } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.outcome.js';
import { runSmsOtpFlow } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/SmsOtpFlow.js';
import { createTokenStrategyFromConfig } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/TokenStrategyFromConfig.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import type { ITokenContext } from '../../../../../../Scrapers/Pipeline/Types/Domain/TokenContext.js';
import type { JsonValue } from '../../../../../../Scrapers/Pipeline/Types/JsonValue.js';
import type { Procedure } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { isOk, succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { type IApiPostCapture, makeStubMediator } from './StubMediator.js';
import { makeJwt, WARM_STEP_TAG, warmTwoStepConfig } from './WarmStartFixtures.js';

const HINT = CompanyTypes.OneZero;
const CTX = { companyId: HINT } as unknown as ITokenContext;

/** '0' succeeds, '7' is a wrong password, anything else is Generic. */
const OUTCOME: IStepOutcome = {
  codePointer: '/status',
  successCodes: ['0'],
  failureMap: { '7': ScraperErrorTypes.InvalidPassword },
  defaultFailure: ScraperErrorTypes.Generic,
};

/** A step without an outcome policy. */
const PLAIN_STEP: IStepConfig = {
  name: 'login',
  urlTag: WARM_STEP_TAG,
  body: { shape: {} },
  extractsToCarry: { token: '/access_token' },
};

/** The same step, judged by OUTCOME. */
const STEP: IStepConfig = { ...PLAIN_STEP, outcome: OUTCOME };

/** Expected failure when the body carries no usable code. */
const MISSING = {
  success: false,
  errorType: ScraperErrorTypes.Generic,
  errorMessage: 'login outcome missing',
};

beforeAll((): void => {
  registerWkUrl(WARM_STEP_TAG, HINT, 'https://example.test/api/outcome');
});

describe('judgeStepOutcome', () => {
  it.each<[string, JsonValue, Record<string, unknown>]>([
    ['a success code', { status: '0' }, { success: true }],
    ['a numeric success code', { status: 0 }, { success: true }],
    [
      'a mapped code',
      { status: 7 },
      {
        success: false,
        errorType: ScraperErrorTypes.InvalidPassword,
        errorMessage: 'login outcome 7',
      },
    ],
    [
      'an unmapped code',
      { status: '9' },
      { success: false, errorType: ScraperErrorTypes.Generic, errorMessage: 'login outcome 9' },
    ],
    ['a missing code', {}, MISSING],
    ['a non-scalar code', { status: { nested: 1 } }, MISSING],
    ['an empty code', { status: '' }, MISSING],
  ])('judges %s', (_label, resp, shape) => {
    const judged = judgeStepOutcome(STEP, resp);
    expect(judged).toMatchObject(shape);
  });

  it('passes any body when the step declares no outcome', () => {
    const judged = judgeStepOutcome(PLAIN_STEP, { status: '9' });
    expect(judged.success).toBe(true);
  });
});

describe('SmsOtpFlow with a step outcome', () => {
  it('fails with the mapped type before the extracts run', async () => {
    const bus = makeStubMediator({ responses: [succeed({ status: 7 })], captures: [] });
    const config: IApiDirectCallConfig = { flow: 'sms-otp', envelope: {}, steps: [STEP] };
    const result = await runSmsOtpFlow({ config, bus, creds: {}, companyId: HINT });
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.InvalidPassword,
      errorMessage: 'login outcome 7',
    });
  });
});

describe('warm resume judged by a step outcome', () => {
  /**
   * Resolve a session through the real resolver (warm attempt, then one cold
   * fallback) on the two-step warm config, every step judged by OUTCOME.
   * @param responses - Scripted apiPost answers, oldest first.
   * @param captures - Records each request the bank receives.
   * @returns The prime result.
   */
  async function primeWithOutcome(
    responses: Procedure<unknown>[],
    captures: IApiPostCapture[],
  ): Promise<Procedure<string>> {
    const base = warmTwoStepConfig();
    const steps = base.steps.map((step): IStepConfig => ({ ...step, outcome: OUTCOME }));
    const proc = createTokenStrategyFromConfig({ config: { ...base, steps } });
    if (!isOk(proc)) throw new ScraperError(proc.errorMessage);
    const creds = { otpLongTermToken: makeJwt(36000) } as unknown as ScraperCredentials;
    const bus = makeStubMediator({ responses, captures });
    const resolver = buildResolverFromStrategy({ strategy: proc.value, bus, ctx: CTX, creds });
    return resolver.resolve();
  }

  it('falls back to one cold flow when the warm step reports failure', async () => {
    const captures: IApiPostCapture[] = [];
    const token = makeJwt(36000);
    // The refused answer still carries a token: only the outcome can fail it.
    const refused = succeed({ status: '9', access_token: token });
    const accepted = succeed({ status: '0', access_token: token });
    const responses = [refused, accepted, accepted];
    const result = await primeWithOutcome(responses, captures);
    expect(result.success).toBe(true);
    expect(captures).toHaveLength(3);
  });

  it("reports the cold flow's failure type", async () => {
    const responses = [succeed({ status: '9' }), succeed({ status: 7 })];
    const result = await primeWithOutcome(responses, []);
    expect(result).toMatchObject({ success: false, errorType: ScraperErrorTypes.InvalidPassword });
  });
});
