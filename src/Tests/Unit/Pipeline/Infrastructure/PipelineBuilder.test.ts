import PipelineBuilder from '../../../../Scrapers/Pipeline/Core/Builder/PipelineBuilder.js';
import { assertOk } from '../../../Helpers/AssertProcedure.js';
import { makeMockOptions, MOCK_API_DIRECT, MOCK_API_DIRECT_SHAPE } from './MockFactories.js';

/** Shared test options. */
const MOCK_OPTIONS = makeMockOptions();

describe('PipelineBuilder/build', () => {
  it('fails when withOptions was not called', () => {
    const builder = new PipelineBuilder();
    const result = builder.build();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('withOptions()');
  });

  it('fails when withApiDirect was not called', () => {
    const builder = new PipelineBuilder();
    builder.withOptions(MOCK_OPTIONS);
    const result = builder.build();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('login mode');
  });
});

describe('PipelineBuilder/chaining', () => {
  it('withOptions returns this', () => {
    const builder = new PipelineBuilder();
    const returned = builder.withOptions(MOCK_OPTIONS);
    expect(returned).toBe(builder);
  });

  it('withApiDirect returns this', () => {
    const builder = new PipelineBuilder();
    const returned = builder.withApiDirect(MOCK_API_DIRECT, MOCK_API_DIRECT_SHAPE);
    expect(returned).toBe(builder);
  });
});

describe('PipelineBuilder/withApiDirect', () => {
  it('builds the api-direct login then scrape, in that order', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withApiDirect(MOCK_API_DIRECT, MOCK_API_DIRECT_SHAPE)
      .build();
    assertOk(descriptor);
    const names = descriptor.value.phases.map(p => p.name);
    expect(names).toEqual(['api-direct-call', 'api-direct-scrape']);
  });

  it('carries the provided options onto the descriptor', () => {
    const descriptor = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withApiDirect(MOCK_API_DIRECT, MOCK_API_DIRECT_SHAPE)
      .build();
    assertOk(descriptor);
    expect(descriptor.value.options).toBe(MOCK_OPTIONS);
  });

  it('fails build when withApiDirect is called twice', () => {
    const result = new PipelineBuilder()
      .withOptions(MOCK_OPTIONS)
      .withApiDirect(MOCK_API_DIRECT, MOCK_API_DIRECT_SHAPE)
      .withApiDirect(MOCK_API_DIRECT, MOCK_API_DIRECT_SHAPE)
      .build();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('login mode already set');
  });
});
