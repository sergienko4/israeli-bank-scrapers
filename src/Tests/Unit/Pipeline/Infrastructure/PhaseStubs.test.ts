import { DASHBOARD_STEP } from '../../../../Scrapers/Pipeline/Phases/DashboardPhase.js';
import { DECLARATIVE_LOGIN_STEP } from '../../../../Scrapers/Pipeline/Phases/DeclarativeLoginPhase.js';
import { DIRECT_POST_LOGIN_STEP } from '../../../../Scrapers/Pipeline/Phases/DirectPostLoginPhase.js';
import { NATIVE_LOGIN_STEP } from '../../../../Scrapers/Pipeline/Phases/NativeLoginPhase.js';
import { OTP_STEP } from '../../../../Scrapers/Pipeline/Phases/OtpPhase.js';
import { SCRAPE_STEP } from '../../../../Scrapers/Pipeline/Phases/ScrapePhase.js';
import { PIPELINE_REGISTRY } from '../../../../Scrapers/Pipeline/PipelineRegistry.js';
import type { IPipelineStep } from '../../../../Scrapers/Pipeline/Types/Phase.js';
import type { IPipelineContext } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { makeMockContext } from './MockFactories.js';

/** Step entry for parameterized tests: [name, step]. */
type StepEntry = [string, IPipelineStep<IPipelineContext, IPipelineContext>];

/** Phase steps that are still stubs (init + terminate have real implementations). */
const STUB_STEPS: StepEntry[] = [
  ['declarative-login', DECLARATIVE_LOGIN_STEP],
  ['direct-post-login', DIRECT_POST_LOGIN_STEP],
  ['native-login', NATIVE_LOGIN_STEP],
  ['otp', OTP_STEP],
  ['dashboard', DASHBOARD_STEP],
  ['scrape', SCRAPE_STEP],
];

describe('Phase stubs', () => {
  it.each(STUB_STEPS)('%s step has correct name', (expectedName, step) => {
    expect(step.name).toBe(expectedName);
  });

  it.each(STUB_STEPS)('%s step returns succeed(input)', async (expectedName, step) => {
    const ctx = makeMockContext();
    const result = await step.execute(ctx, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(ctx);
    }
    expect(expectedName).toBeTruthy();
  });
});

describe('PipelineRegistry', () => {
  it('is an empty object initially', () => {
    const keyCount = Object.keys(PIPELINE_REGISTRY).length;
    expect(keyCount).toBe(0);
  });
});
