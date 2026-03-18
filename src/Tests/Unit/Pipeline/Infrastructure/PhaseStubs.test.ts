import { DASHBOARD_STEP } from '../../../../Scrapers/Pipeline/Phases/DashboardPhase.js';
import { DECLARATIVE_LOGIN_STEP } from '../../../../Scrapers/Pipeline/Phases/DeclarativeLoginPhase.js';
import { DIRECT_POST_LOGIN_STEP } from '../../../../Scrapers/Pipeline/Phases/DirectPostLoginPhase.js';
import { INIT_STEP } from '../../../../Scrapers/Pipeline/Phases/InitPhase.js';
import { NATIVE_LOGIN_STEP } from '../../../../Scrapers/Pipeline/Phases/NativeLoginPhase.js';
import { OTP_STEP } from '../../../../Scrapers/Pipeline/Phases/OtpPhase.js';
import { SCRAPE_STEP } from '../../../../Scrapers/Pipeline/Phases/ScrapePhase.js';
import { TERMINATE_STEP } from '../../../../Scrapers/Pipeline/Phases/TerminatePhase.js';
import { PIPELINE_REGISTRY } from '../../../../Scrapers/Pipeline/PipelineRegistry.js';
import type { IPipelineContext } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';

/** Minimal mock context for phase step execution. */
const MOCK_CTX = { companyId: 'test' } as unknown as IPipelineContext;

describe('Phase stubs', () => {
  it.each([
    ['init-browser', INIT_STEP],
    ['declarative-login', DECLARATIVE_LOGIN_STEP],
    ['direct-post-login', DIRECT_POST_LOGIN_STEP],
    ['native-login', NATIVE_LOGIN_STEP],
    ['otp', OTP_STEP],
    ['dashboard', DASHBOARD_STEP],
    ['scrape', SCRAPE_STEP],
    ['terminate', TERMINATE_STEP],
  ])('%s step has correct name', (expectedName, step) => {
    expect(step.name).toBe(expectedName);
  });

  it.each([
    ['init-browser', INIT_STEP],
    ['declarative-login', DECLARATIVE_LOGIN_STEP],
    ['direct-post-login', DIRECT_POST_LOGIN_STEP],
    ['native-login', NATIVE_LOGIN_STEP],
    ['otp', OTP_STEP],
    ['dashboard', DASHBOARD_STEP],
    ['scrape', SCRAPE_STEP],
    ['terminate', TERMINATE_STEP],
  ])('%s step returns succeed(input)', async (name, step) => {
    const result = await step.execute(MOCK_CTX, MOCK_CTX);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(MOCK_CTX);
    }
    expect(name).toBeTruthy();
  });
});

describe('PipelineRegistry', () => {
  it('is an empty object initially', () => {
    expect(Object.keys(PIPELINE_REGISTRY).length).toBe(0);
  });
});
