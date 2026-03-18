import { jest } from '@jest/globals';

import type { IPipelineDescriptor } from '../../../../Scrapers/Pipeline/PipelineDescriptor.js';
import { PipelineScraper } from '../../../../Scrapers/Pipeline/PipelineScraper.js';

/** Minimal ScraperOptions. */
const MOCK_OPTIONS = {
  companyId: 'testBank',
  startDate: new Date('2024-01-01'),
} as never;

/** Minimal credentials. */
const MOCK_CREDENTIALS = { username: 'user', password: 'pass' };

/**
 * Stub pipeline builder.
 * @returns Minimal pipeline descriptor.
 */
function mockBuildPipeline(): IPipelineDescriptor {
  return { options: MOCK_OPTIONS, phases: [] };
}

describe('PipelineScraper/scrape', () => {
  it('delegates to executePipeline and returns result', async () => {
    const scraper = new PipelineScraper(MOCK_OPTIONS, mockBuildPipeline);
    const result = await scraper.scrape(MOCK_CREDENTIALS);
    expect(result.success).toBe(true);
  });

  it('calls buildPipeline with stored options', async () => {
    const buildSpy = jest.fn(mockBuildPipeline);
    const scraper = new PipelineScraper(MOCK_OPTIONS, buildSpy);
    await scraper.scrape(MOCK_CREDENTIALS);
    expect(buildSpy).toHaveBeenCalledTimes(1);
  });
});

describe('PipelineScraper/onProgress', () => {
  it('registers a progress listener without throwing', () => {
    const scraper = new PipelineScraper(MOCK_OPTIONS, mockBuildPipeline);
    const callback = jest.fn() as never;
    scraper.onProgress(callback);
  });
});

describe('PipelineScraper/triggerTwoFactorAuth', () => {
  it('throws with masked phone number', () => {
    const scraper = new PipelineScraper(MOCK_OPTIONS, mockBuildPipeline);
    expect(() => scraper.triggerTwoFactorAuth('0501234567')).toThrow('***4567');
  });

  it('includes bank name in error message', () => {
    const scraper = new PipelineScraper(MOCK_OPTIONS, mockBuildPipeline);
    expect(() => scraper.triggerTwoFactorAuth('0501234567')).toThrow('testBank');
  });
});

describe('PipelineScraper/getLongTermTwoFactorToken', () => {
  it('throws with code length', () => {
    const scraper = new PipelineScraper(MOCK_OPTIONS, mockBuildPipeline);
    expect(() => scraper.getLongTermTwoFactorToken('123456')).toThrow('6 chars');
  });

  it('includes bank name in error message', () => {
    const scraper = new PipelineScraper(MOCK_OPTIONS, mockBuildPipeline);
    expect(() => scraper.getLongTermTwoFactorToken('1234')).toThrow('testBank');
  });
});
