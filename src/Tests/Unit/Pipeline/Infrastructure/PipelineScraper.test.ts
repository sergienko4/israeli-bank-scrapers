import { jest } from '@jest/globals';

import { PipelineScraper } from '../../../../Scrapers/Pipeline/PipelineScraper.js';
import { makeMockCredentials, makeMockDescriptor, makeMockOptions } from './MockFactories.js';

const MOCK_OPTIONS = makeMockOptions({ companyId: 'testBank' as never });
const MOCK_CREDENTIALS = makeMockCredentials();

/**
 * Stub pipeline builder.
 * @returns Minimal pipeline descriptor.
 */
function mockBuildPipeline(): ReturnType<typeof makeMockDescriptor> {
  return makeMockDescriptor(MOCK_OPTIONS);
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
    expect(buildSpy).toHaveBeenCalledWith(MOCK_OPTIONS);
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
  it('rejects with masked phone number', async () => {
    const scraper = new PipelineScraper(MOCK_OPTIONS, mockBuildPipeline);
    const promise = scraper.triggerTwoFactorAuth('0501234567');
    await expect(promise).rejects.toThrow('***4567');
  });

  it('includes bank name in rejection', async () => {
    const scraper = new PipelineScraper(MOCK_OPTIONS, mockBuildPipeline);
    const promise = scraper.triggerTwoFactorAuth('0501234567');
    await expect(promise).rejects.toThrow('testBank');
  });
});

describe('PipelineScraper/getLongTermTwoFactorToken', () => {
  it('rejects with code length', async () => {
    const scraper = new PipelineScraper(MOCK_OPTIONS, mockBuildPipeline);
    const promise = scraper.getLongTermTwoFactorToken('123456');
    await expect(promise).rejects.toThrow('6 chars');
  });

  it('includes bank name in rejection', async () => {
    const scraper = new PipelineScraper(MOCK_OPTIONS, mockBuildPipeline);
    const promise = scraper.getLongTermTwoFactorToken('1234');
    await expect(promise).rejects.toThrow('testBank');
  });
});
