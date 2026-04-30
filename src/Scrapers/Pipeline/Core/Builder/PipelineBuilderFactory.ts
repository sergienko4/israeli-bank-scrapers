/** Factory helper for PipelineBuilder — split from PipelineBuilder.ts to keep file under 150 lines. */

import { PipelineBuilder } from './PipelineBuilder.js';

/**
 * Factory: create a new PipelineBuilder.
 * @returns Fresh PipelineBuilder.
 */
function createPipelineBuilder(): PipelineBuilder {
  return Reflect.construct(PipelineBuilder, []);
}

export { createPipelineBuilder };
export default createPipelineBuilder;
