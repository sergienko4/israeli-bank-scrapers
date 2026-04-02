/**
 * Amex pipeline — 100% generic. Zero legacy imports.
 * GenericAutoScrape handles everything via network traffic discovery.
 */

import type { ScraperOptions } from '../../../Base/Interface.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import { createPipelineBuilder } from '../../Core/PipelineBuilder.js';
import type { IPipelineDescriptor } from '../../Core/PipelineDescriptor.js';
import type { Procedure } from '../../Types/Procedure.js';

/** Amex login config — credential keys only. WellKnown resolves selectors. */
export const AMEX_LOGIN: ILoginConfig = {
  loginUrl: '',
  fields: [
    { credentialKey: 'id', selectors: [] },
    { credentialKey: 'password', selectors: [] },
    { credentialKey: 'card6Digits', selectors: [] },
  ],
  submit: [],
  possibleResults: { success: [] },
};

/**
 * Build the Amex pipeline descriptor.
 * @param options - Scraper options from the user.
 * @returns Pipeline descriptor.
 */
function buildAmexPipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return createPipelineBuilder()
    .withOptions(options)
    .withBrowser()
    .withDeclarativeLogin(AMEX_LOGIN)
    .build();
}

export default buildAmexPipeline;
export { buildAmexPipeline };
