/**
 * A context-build failure becomes a typed pipeline failure, not a throw.
 */

import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import type { ScraperCredentials, ScraperOptions } from '../../../../Scrapers/Base/Interface.js';
import executePipeline from '../../../../Scrapers/Pipeline/Core/Executor/PipelineExecutor.js';
import type { IPipelineDescriptor } from '../../../../Scrapers/Pipeline/Core/PipelineDescriptor.js';

describe('executePipeline — context build failure', () => {
  it('returns a typed failure when the bank is not registered', async () => {
    const options = {
      companyId: 'not-a-bank',
      startDate: new Date(),
    } as unknown as ScraperOptions;
    const descriptor: IPipelineDescriptor = { options, phases: [] };
    const result = await executePipeline(descriptor, {} as ScraperCredentials);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
    });
    expect(result.errorMessage).toContain('No run without bank');
  });
});
