import type { OtpConfig } from '../../../../Scrapers/Base/Config/LoginConfigTypes.js';
import type { ILoginConfig } from '../../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import { PipelineBuilder } from '../../../../Scrapers/Pipeline/PipelineBuilder.js';
import type { IPipelineContext } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';

/** Minimal ScraperOptions for testing. */
const MOCK_OPTIONS = {
  companyId: 'test' as never,
  startDate: new Date('2024-01-01'),
} as never;

/** Minimal ILoginConfig stub. */
const MOCK_LOGIN_CONFIG: ILoginConfig = {
  loginUrl: 'https://bank.example.com/login',
  fields: [],
  submit: { kind: 'textContent', value: 'Login' },
  possibleResults: {},
} as never;

/**
 * Stub login function for direct-POST mode.
 * @param ctx - Pipeline context.
 * @returns Resolved succeed procedure.
 */
const MOCK_DIRECT_LOGIN = (ctx: IPipelineContext): Promise<Procedure<IPipelineContext>> => {
  const result = succeed(ctx);
  return Promise.resolve(result);
};

/**
 * Stub login function for native mode.
 * @param ctx - Pipeline context.
 * @returns Resolved succeed procedure.
 */
const MOCK_NATIVE_LOGIN = (ctx: IPipelineContext): Promise<Procedure<IPipelineContext>> => {
  const result = succeed(ctx);
  return Promise.resolve(result);
};

/**
 * Stub scrape function.
 * @param ctx - Pipeline context.
 * @returns Resolved succeed procedure.
 */
const MOCK_SCRAPE = (ctx: IPipelineContext): Promise<Procedure<IPipelineContext>> => {
  const result = succeed(ctx);
  return Promise.resolve(result);
};

/** Minimal OTP config. */
const MOCK_OTP_CONFIG: OtpConfig = { kind: 'api' };

describe('PipelineBuilder/build', () => {
  it('throws when withOptions was not called', () => {
    const builder = new PipelineBuilder();
    expect(() => builder.build()).toThrow('withOptions() is required');
  });

  it('throws when no login mode was set', () => {
    const builder = new PipelineBuilder();
    builder.withOptions(MOCK_OPTIONS);
    expect(() => builder.build()).toThrow('a login mode is required');
  });
});

describe('PipelineBuilder/withOptions', () => {
  it('sets options and returns this for chaining', () => {
    const builder = new PipelineBuilder();
    const returned = builder.withOptions(MOCK_OPTIONS);
    expect(returned).toBe(builder);
  });
});

describe('PipelineBuilder/withBrowser', () => {
  it('returns this for chaining', () => {
    const builder = new PipelineBuilder();
    const returned = builder.withBrowser();
    expect(returned).toBe(builder);
  });
});

describe('PipelineBuilder/withDeclarativeLogin', () => {
  it('sets login mode and returns this', () => {
    const builder = new PipelineBuilder();
    builder.withOptions(MOCK_OPTIONS);
    const returned = builder.withDeclarativeLogin(MOCK_LOGIN_CONFIG);
    expect(returned).toBe(builder);
  });

  it('allows build after setting declarative login', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withDeclarativeLogin(MOCK_LOGIN_CONFIG)
      .build();
    expect(descriptor.options).toBe(MOCK_OPTIONS);
  });
});

describe('PipelineBuilder/withDirectPostLogin', () => {
  it('sets login mode and returns this', () => {
    const builder = new PipelineBuilder();
    builder.withOptions(MOCK_OPTIONS);
    const returned = builder.withDirectPostLogin(MOCK_DIRECT_LOGIN);
    expect(returned).toBe(builder);
  });

  it('allows build after setting direct post login', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withDirectPostLogin(MOCK_DIRECT_LOGIN)
      .build();
    expect(descriptor.options).toBe(MOCK_OPTIONS);
  });
});

describe('PipelineBuilder/withNativeLogin', () => {
  it('allows build after setting native login', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withNativeLogin(MOCK_NATIVE_LOGIN)
      .build();
    expect(descriptor.options).toBe(MOCK_OPTIONS);
  });
});

describe('PipelineBuilder/mutual-exclusion', () => {
  it('throws when calling withDeclarativeLogin after withDirectPostLogin', () => {
    const builder = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withDirectPostLogin(MOCK_DIRECT_LOGIN);
    expect(() => builder.withDeclarativeLogin(MOCK_LOGIN_CONFIG)).toThrow('login mode already set');
  });

  it('throws when calling withDirectPostLogin after withDeclarativeLogin', () => {
    const builder = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withDeclarativeLogin(MOCK_LOGIN_CONFIG);
    expect(() => builder.withDirectPostLogin(MOCK_DIRECT_LOGIN)).toThrow('login mode already set');
  });

  it('throws when calling withNativeLogin after withDeclarativeLogin', () => {
    const builder = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withDeclarativeLogin(MOCK_LOGIN_CONFIG);
    expect(() => builder.withNativeLogin(MOCK_NATIVE_LOGIN)).toThrow('login mode already set');
  });
});

describe('PipelineBuilder/optional-phases', () => {
  it('withOtp returns this', () => {
    const builder = new PipelineBuilder();
    const returned = builder.withOtp(MOCK_OTP_CONFIG);
    expect(returned).toBe(builder);
  });

  it('withDashboard returns this', () => {
    const builder = new PipelineBuilder();
    const returned = builder.withDashboard();
    expect(returned).toBe(builder);
  });

  it('withScraper returns this', () => {
    const builder = new PipelineBuilder();
    const returned = builder.withScraper(MOCK_SCRAPE);
    expect(returned).toBe(builder);
  });
});

describe('PipelineBuilder/full-config', () => {
  it('builds with all optional phases configured', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withBrowser()
      .withDeclarativeLogin(MOCK_LOGIN_CONFIG)
      .withOtp(MOCK_OTP_CONFIG)
      .withDashboard()
      .withScraper(MOCK_SCRAPE)
      .build();
    expect(descriptor.options).toBe(MOCK_OPTIONS);
  });

  it('builds with directPostLogin + all optional phases', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withBrowser()
      .withDirectPostLogin(MOCK_DIRECT_LOGIN)
      .withOtp(MOCK_OTP_CONFIG)
      .withDashboard()
      .withScraper(MOCK_SCRAPE)
      .build();
    expect(descriptor.options).toBe(MOCK_OPTIONS);
  });

  it('builds with nativeLogin without browser', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withNativeLogin(MOCK_NATIVE_LOGIN)
      .withScraper(MOCK_SCRAPE)
      .build();
    expect(descriptor.options).toBe(MOCK_OPTIONS);
  });
});

describe('PipelineBuilder/descriptor-shape', () => {
  it('returns descriptor with phases array', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withDeclarativeLogin(MOCK_LOGIN_CONFIG)
      .build();
    const isArray = Array.isArray(descriptor.phases);
    expect(isArray).toBe(true);
  });

  it('returns descriptor with the provided options', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withNativeLogin(MOCK_NATIVE_LOGIN)
      .build();
    expect(descriptor.options).toBe(MOCK_OPTIONS);
  });
});

describe('PipelineBuilder/phase-assembly', () => {
  it('declarative login produces a login phase', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withDeclarativeLogin(MOCK_LOGIN_CONFIG)
      .build();
    const names = descriptor.phases.map(p => p.name);
    expect(names).toContain('login');
  });

  it('withBrowser adds init phase at the start', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withBrowser()
      .withDeclarativeLogin(MOCK_LOGIN_CONFIG)
      .build();
    const firstPhase = descriptor.phases[0];
    expect(firstPhase.name).toBe('init');
  });

  it('withOtp adds otp phase after login', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withDeclarativeLogin(MOCK_LOGIN_CONFIG)
      .withOtp(MOCK_OTP_CONFIG)
      .build();
    const names = descriptor.phases.map(p => p.name);
    const loginIdx = names.indexOf('login');
    const otpIdx = names.indexOf('otp');
    expect(otpIdx).toBeGreaterThan(loginIdx);
  });

  it('withDashboard adds dashboard phase', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withDeclarativeLogin(MOCK_LOGIN_CONFIG)
      .withDashboard()
      .build();
    const names = descriptor.phases.map(p => p.name);
    expect(names).toContain('dashboard');
  });

  it('withScraper adds scrape phase', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withDeclarativeLogin(MOCK_LOGIN_CONFIG)
      .withScraper(MOCK_SCRAPE)
      .build();
    const names = descriptor.phases.map(p => p.name);
    expect(names).toContain('scrape');
  });

  it('phases are ordered: init → login → otp → dashboard → scrape', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withBrowser()
      .withDeclarativeLogin(MOCK_LOGIN_CONFIG)
      .withOtp(MOCK_OTP_CONFIG)
      .withDashboard()
      .withScraper(MOCK_SCRAPE)
      .build();
    const names = descriptor.phases.map(p => p.name);
    const initIdx = names.indexOf('init');
    const loginIdx = names.indexOf('login');
    const otpIdx = names.indexOf('otp');
    const dashIdx = names.indexOf('dashboard');
    expect(initIdx).toBeLessThan(loginIdx);
    expect(loginIdx).toBeLessThan(otpIdx);
    expect(otpIdx).toBeLessThan(dashIdx);
  });

  it('without browser, no init phase', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withNativeLogin(MOCK_NATIVE_LOGIN)
      .build();
    const names = descriptor.phases.map(p => p.name);
    expect(names).not.toContain('init');
  });

  it('login-only produces exactly 1 phase', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withDirectPostLogin(MOCK_DIRECT_LOGIN)
      .build();
    expect(descriptor.phases.length).toBe(1);
    expect(descriptor.phases[0].name).toBe('login');
  });

  it('withBrowser adds terminate phase at the end', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withBrowser()
      .withDeclarativeLogin(MOCK_LOGIN_CONFIG)
      .build();
    const names = descriptor.phases.map(p => p.name);
    const lastPhase = names.at(-1);
    expect(lastPhase).toBe('terminate');
  });

  it('optional phases are inserted before terminate', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withBrowser()
      .withDeclarativeLogin(MOCK_LOGIN_CONFIG)
      .withOtp(MOCK_OTP_CONFIG)
      .withDashboard()
      .withScraper(MOCK_SCRAPE)
      .build();
    const names = descriptor.phases.map(p => p.name);
    const terminateIdx = names.lastIndexOf('terminate');
    const scrapeIdx = names.indexOf('scrape');
    expect(scrapeIdx).toBeLessThan(terminateIdx);
  });
});

describe('PipelineBuilder/behavioral', () => {
  it('built phases are executable and return success', async () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withDeclarativeLogin(MOCK_LOGIN_CONFIG)
      .build();
    const phase = descriptor.phases[0];
    const mockCtx = {} as never;
    const result = await phase.action.execute(mockCtx, mockCtx);
    expect(result.ok).toBe(true);
  });
});
