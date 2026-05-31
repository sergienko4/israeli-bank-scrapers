/**
 * Mercantile pipeline — 100% generic. Zero legacy imports.
 * Shares infrastructure with Discount (start.telebank.co.il) but maintained separately.
 */

import type { ScraperOptions } from '../../../Base/Interface.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import { createPipelineBuilder } from '../../Core/Builder/PipelineBuilder.js';
import type { IPipelineDescriptor } from '../../Core/PipelineDescriptor.js';
import type { Procedure } from '../../Types/Procedure.js';

/** Mercantile login config — credential keys only. WellKnown resolves selectors. */
export const MERCANTILE_LOGIN: ILoginConfig = {
  loginUrl: '',
  fields: [
    { credentialKey: 'id', selectors: [] },
    { credentialKey: 'password', selectors: [] },
    { credentialKey: 'num', selectors: [] },
  ],
  submit: [],
  possibleResults: { success: [] },
};

/**
 * Build the Mercantile pipeline descriptor.
 * @param options - Scraper options from the user.
 * @returns Pipeline descriptor.
 */
function buildMercantilePipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return createPipelineBuilder()
    .withOptions(options)
    .withBrowser()
    .withDeclarativeLogin(MERCANTILE_LOGIN)
    .build();
}

export default buildMercantilePipeline;
export { buildMercantilePipeline };
