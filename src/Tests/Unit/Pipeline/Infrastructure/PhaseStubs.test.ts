import {
  createLoginStep,
  DECLARATIVE_LOGIN_STEP,
} from '../../../../Scrapers/Pipeline/Core/DeclarativeLoginPhase.js';
import { DIRECT_POST_LOGIN_STEP } from '../../../../Scrapers/Pipeline/Core/DirectPostLoginPhase.js';
import { NATIVE_LOGIN_STEP } from '../../../../Scrapers/Pipeline/Core/NativeLoginPhase.js';
import { PIPELINE_REGISTRY } from '../../../../Scrapers/Pipeline/Core/PipelineRegistry.js';
import { OTP_STEP } from '../../../../Scrapers/Pipeline/Phases/Otp/OtpPhase.js';
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
  ['otp', OTP_STEP],
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
      expect(result.value).toBe(ctx);
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
  it('contains Amex, Discount, Isracard, Max, and VisaCal', () => {
    const keys = Object.keys(PIPELINE_REGISTRY);
    expect(keys).toContain('amex');
    expect(keys).toContain('discount');
    expect(keys).toContain('isracard');
    expect(keys).toContain('max');
    expect(keys).toContain('visaCal');
    expect(keys).toHaveLength(5);
  });
});
