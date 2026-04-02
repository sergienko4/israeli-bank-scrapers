import { jest } from '@jest/globals';

import type { CompanyTypes } from '../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import { PipelineScraper } from '../../../../Scrapers/Pipeline/Core/PipelineScraper.js';
import { fail } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockCredentials, makeMockDescriptor, makeMockOptions } from './MockFactories.js';

const MOCK_OPTIONS = makeMockOptions({ companyId: 'testBank' as unknown as CompanyTypes });
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

  it('returns legacy failure when buildPipeline fails', async () => {
    /**
     * Stub that always returns failure.
     * @returns Failed procedure.
     */
    const buildFailing = (): ReturnType<typeof makeMockDescriptor> =>
      fail(ScraperErrorTypes.Generic, 'build failed');
    const scraper = new PipelineScraper(MOCK_OPTIONS, buildFailing);
    const result = await scraper.scrape(MOCK_CREDENTIALS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.Generic);
  });
});

describe('PipelineScraper/onProgress', () => {
  it('registers a progress listener without throwing', () => {
    const scraper = new PipelineScraper(MOCK_OPTIONS, mockBuildPipeline);
    const callback = jest.fn() as unknown as Parameters<typeof scraper.onProgress>[0];
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
