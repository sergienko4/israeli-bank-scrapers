import {
  createLoginStep,
  DECLARATIVE_LOGIN_STEP,
} from '../../../../Scrapers/Pipeline/Core/LoginSteps/DeclarativeLoginStep.js';
import { DIRECT_POST_LOGIN_STEP } from '../../../../Scrapers/Pipeline/Core/LoginSteps/DirectPostLoginStep.js';
import { NATIVE_LOGIN_STEP } from '../../../../Scrapers/Pipeline/Core/LoginSteps/NativeLoginStep.js';
import { PIPELINE_REGISTRY } from '../../../../Scrapers/Pipeline/Core/PipelineRegistry.js';
import { OTP_FILL_STEP } from '../../../../Scrapers/Pipeline/Phases/OtpFill/OtpFillPhase.js';
import { OTP_TRIGGER_STEP } from '../../../../Scrapers/Pipeline/Phases/OtpTrigger/OtpTriggerPhase.js';
import { SCRAPE_STEP } from '../../../../Scrapers/Pipeline/Phases/Scrape/ScrapePhase.js';
import type { IPipelineStep } from '../../../../Scrapers/Pipeline/Types/Phase.js';
import type { IPipelineContext } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from './MockFactories.js';

/** Step entry for parameterized tests: [name, step]. */
type StepEntry = [string, IPipelineStep<IPipelineContext, IPipelineContext>];

/** Phase steps that are still stubs (init + terminate have real implementations). */
const STUB_STEPS: StepEntry[] = [
  ['declarative-login', DECLARATIVE_LOGIN_STEP],
  ['direct-post-login', DIRECT_POST_LOGIN_STEP],
  ['native-login', NATIVE_LOGIN_STEP],
  ['otp-trigger', OTP_TRIGGER_STEP],
  ['otp-fill', OTP_FILL_STEP],
  ['scrape', SCRAPE_STEP],
];

describe('Phase stubs', () => {
  it.each(STUB_STEPS)('%s step has correct name', (expectedName, step) => {
    expect(step.name).toBe(expectedName);
  });

  it.each(STUB_STEPS)('%s step returns succeed(input)', async (_expectedName, step) => {
    const ctx = makeMockContext();
    const result = await step.execute(ctx, ctx);
    expect(result.success).toBe(true);
    if (result.success) {
      const matcher: unknown = expect.objectContaining({ companyId: ctx.companyId });
      expect(result.value).toEqual(matcher);
    }
  });
});

describe('createLoginStep', () => {
  it('executes the provided login function with input context', async () => {
    const ctx = makeMockContext();
    /**
     * Mock login function that returns succeed(input).
     * @param input - Pipeline context.
     * @returns Success procedure.
     */
    const mockFn = (input: IPipelineContext): Promise<Procedure<IPipelineContext>> => {
      const result = succeed(input);
      return Promise.resolve(result);
    };
    const step = createLoginStep(mockFn);
    expect(step.name).toBe('declarative-login');
    const result = await step.execute(ctx, ctx);
    expect(result.success).toBe(true);
  });
});

describe('PipelineRegistry', () => {
  it('contains 13 pipeline banks', () => {
    const keys = Object.keys(PIPELINE_REGISTRY);
    expect(keys).toContain('amex');
    expect(keys).toContain('beinleumi');
    expect(keys).toContain('discount');
    expect(keys).toContain('hapoalim');
    expect(keys).toContain('isracard');
    expect(keys).toContain('massad');
    expect(keys).toContain('max');
    expect(keys).toContain('mercantile');
    expect(keys).toContain('oneZero');
    expect(keys).toContain('otsarHahayal');
    expect(keys).toContain('pagi');
    expect(keys).toContain('pepper');
    expect(keys).toContain('visaCal');
    expect(keys).toHaveLength(13);
  });
});
