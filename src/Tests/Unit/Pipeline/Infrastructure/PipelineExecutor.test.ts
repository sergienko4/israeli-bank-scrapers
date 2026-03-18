import type { IPipelineDescriptor } from '../../../../Scrapers/Pipeline/PipelineDescriptor.js';
import { executePipeline } from '../../../../Scrapers/Pipeline/PipelineExecutor.js';

/** Minimal ScraperOptions. */
const MOCK_OPTIONS = {
  companyId: 'test',
  startDate: new Date('2024-01-01'),
} as never;

/** Minimal credentials. */
const MOCK_CREDENTIALS = { username: 'user', password: 'pass' };

describe('PipelineExecutor/stub', () => {
  it('returns success result', async () => {
    const descriptor: IPipelineDescriptor = {
      options: MOCK_OPTIONS,
      phases: [],
    };
    const result = await executePipeline(descriptor, MOCK_CREDENTIALS);
    expect(result.success).toBe(true);
  });

  it('includes stub info with phase and credential counts', async () => {
    const descriptor: IPipelineDescriptor = {
      options: MOCK_OPTIONS,
      phases: [],
    };
    const result = await executePipeline(descriptor, MOCK_CREDENTIALS);
    expect(result.errorMessage).toContain('0 phases');
    expect(result.errorMessage).toContain('2 credential keys');
  });

  it('returns a promise (async interface)', () => {
    const descriptor: IPipelineDescriptor = {
      options: MOCK_OPTIONS,
      phases: [],
    };
    const promise = executePipeline(descriptor, MOCK_CREDENTIALS);
    expect(promise).toBeInstanceOf(Promise);
  });
});
