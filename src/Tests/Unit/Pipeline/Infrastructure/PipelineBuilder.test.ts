import { PipelineBuilder } from '../../../../Scrapers/Pipeline/Core/Builder/PipelineBuilder.js';
import { assertOk } from '../../../Helpers/AssertProcedure.js';
import {
  makeMockOptions,
  MOCK_API_DIRECT,
  MOCK_LOGIN_CONFIG,
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

describe('PipelineBuilder/mutual-exclusion', () => {
  it('fails build after withDeclarativeLogin + withApiDirect', () => {
    const result = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withDeclarativeLogin(MOCK_LOGIN_CONFIG)
      .withApiDirect(MOCK_API_DIRECT)
      .build();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('login mode already set');
  });
});

describe('PipelineBuilder/optional-phases', () => {
  it('withOtpFill returns this', () => {
    const builder = new PipelineBuilder();
    const returned = builder.withOtpFill();
    expect(returned).toBe(builder);
  });

  it('withOtpTrigger returns this', () => {
    const builder = new PipelineBuilder();
    const returned = builder.withOtpTrigger();
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
      .withOtpTrigger()
      .withOtpFill()
      .withScraper(MOCK_SCRAPE)
      .build();
    assertOk(descriptor);
    const desc = descriptor.value;
    expect(desc.options).toBe(MOCK_OPTIONS);
  });

  it('builds with apiDirect headless path + scraper', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withHeadlessMediator()
      .withApiDirect(MOCK_API_DIRECT)
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
      .withDeclarativeLogin(MOCK_LOGIN_CONFIG)
      .build();
    assertOk(descriptor);
    const desc = descriptor.value;
    expect(desc.options).toBe(MOCK_OPTIONS);
  });
});
