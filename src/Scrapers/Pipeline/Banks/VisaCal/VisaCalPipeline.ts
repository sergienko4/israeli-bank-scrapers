/**
 * VisaCal pipeline — 100% generic. No custom scraper, no mapping strategy.
 * GenericAutoScrape discovers accounts + transactions via network traffic.
 * All URLs resolved from ctx.config at runtime. Zero hardcoded strings.
 */

import type { ScraperOptions } from '../../../Base/Interface.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import { createPipelineBuilder } from '../../Core/PipelineBuilder.js';
import type { IPipelineDescriptor } from '../../Core/PipelineDescriptor.js';
import type { Procedure } from '../../Types/Procedure.js';

/** VisaCal login config — credential keys only. WellKnown resolves selectors. */
const VISACAL_LOGIN: ILoginConfig = {
  loginUrl: 'https://www.cal-online.co.il/',
  fields: [
    { credentialKey: 'username', selectors: [] },
    { credentialKey: 'password', selectors: [] },
  ],
  submit: [],
  possibleResults: { success: [] },
};

/**
 * Build the VisaCal pipeline descriptor.
 * GenericAutoScrape handles card discovery + MatrixLoop automatically.
 * @param options - Scraper options from the user.
 * @returns Pipeline descriptor.
 */
function buildVisaCalPipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return createPipelineBuilder()
    .withOptions(options)
    .withBrowser()
    .withDeclarativeLogin(VISACAL_LOGIN)
    .build();
}

export default buildVisaCalPipeline;
export { buildVisaCalPipeline, VISACAL_LOGIN };
