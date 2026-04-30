import { PipelineBuilder } from '../../../../Scrapers/Pipeline/Core/Builder/PipelineBuilder.js';
import { assertOk } from '../../../Helpers/AssertProcedure.js';
import {
  makeMockOptions,
  MOCK_DIRECT_LOGIN,
  MOCK_LOGIN_CONFIG,
  MOCK_NATIVE_LOGIN,
  MOCK_SCRAPE,
} from './MockFactories.js';

/** Shared test options. */
const MOCK_OPTIONS = makeMockOptions();

describe('PipelineBuilder/build', () => {
  it('fails when withOptions was not called', () => {
    const builder = new PipelineBuilder();
    const result = builder.build();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('withOptions()');
  });

  it('fails when no login mode was set', () => {
    const builder = new PipelineBuilder();
    builder.withOptions(MOCK_OPTIONS);
    const result = builder.build();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('login mode');
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
    assertOk(descriptor);
    const desc = descriptor.value;
    expect(desc.options).toBe(MOCK_OPTIONS);
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
    assertOk(descriptor);
    const desc = descriptor.value;
    expect(desc.options).toBe(MOCK_OPTIONS);
  });
});

describe('PipelineBuilder/withNativeLogin', () => {
  it('allows build after setting native login', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withNativeLogin(MOCK_NATIVE_LOGIN)
      .build();
    assertOk(descriptor);
    const desc = descriptor.value;
    expect(desc.options).toBe(MOCK_OPTIONS);
  });
});

describe('PipelineBuilder/mutual-exclusion', () => {
  it('fails build after withDeclarativeLogin + withDirectPostLogin', () => {
    const result = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withDirectPostLogin(MOCK_DIRECT_LOGIN)
      .withDeclarativeLogin(MOCK_LOGIN_CONFIG)
      .build();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('login mode already set');
  });

  it('fails build after withDirectPostLogin + withDeclarativeLogin', () => {
    const result = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withDeclarativeLogin(MOCK_LOGIN_CONFIG)
      .withDirectPostLogin(MOCK_DIRECT_LOGIN)
      .build();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('login mode already set');
  });

  it('fails build after withNativeLogin + withDeclarativeLogin', () => {
    const result = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withDeclarativeLogin(MOCK_LOGIN_CONFIG)
      .withNativeLogin(MOCK_NATIVE_LOGIN)
      .build();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('login mode already set');
  });
});

describe('PipelineBuilder/optional-phases', () => {
  it('withLoginAndOptCodeFill returns this', () => {
    const builder = new PipelineBuilder();
    const returned = builder.withLoginAndOptCodeFill();
    expect(returned).toBe(builder);
  });

  it('withLoginAndOtpTrigger returns this', () => {
    const builder = new PipelineBuilder();
    const returned = builder.withLoginAndOtpTrigger();
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
      .withLoginAndOtpTrigger()
      .withLoginAndOptCodeFill()
      .withScraper(MOCK_SCRAPE)
      .build();
    assertOk(descriptor);
    const desc = descriptor.value;
    expect(desc.options).toBe(MOCK_OPTIONS);
  });

  it('builds with directPostLogin + all optional phases', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withBrowser()
      .withDirectPostLogin(MOCK_DIRECT_LOGIN)
      .withLoginAndOtpTrigger()
      .withLoginAndOptCodeFill()
      .withScraper(MOCK_SCRAPE)
      .build();
    assertOk(descriptor);
    const desc = descriptor.value;
    expect(desc.options).toBe(MOCK_OPTIONS);
  });

  it('builds with nativeLogin without browser', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withNativeLogin(MOCK_NATIVE_LOGIN)
      .withScraper(MOCK_SCRAPE)
      .build();
    assertOk(descriptor);
    const desc = descriptor.value;
    expect(desc.options).toBe(MOCK_OPTIONS);
  });
});

describe('PipelineBuilder/descriptor-shape', () => {
  it('returns descriptor with phases array', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withDeclarativeLogin(MOCK_LOGIN_CONFIG)
      .build();
    assertOk(descriptor);
    const desc = descriptor.value;
    const isArray = Array.isArray(desc.phases);
    expect(isArray).toBe(true);
  });

  it('returns descriptor with the provided options', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withNativeLogin(MOCK_NATIVE_LOGIN)
      .build();
    assertOk(descriptor);
    const desc = descriptor.value;
    expect(desc.options).toBe(MOCK_OPTIONS);
  });
});
