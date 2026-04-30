/**
 * Massad pipeline — Beinleumi group, same Mataf Angular portal.
 * GenericAutoScrape handles everything via network traffic discovery.
 */

import type { ScraperOptions } from '../../../Base/Interface.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import { createPipelineBuilder } from '../../Core/Builder/PipelineBuilder.js';
import type { IPipelineDescriptor } from '../../Core/PipelineDescriptor.js';
import type { Procedure } from '../../Types/Procedure.js';

/** Massad login config — credential keys only. WellKnown resolves selectors. */
const MASSAD_LOGIN: ILoginConfig = {
  loginUrl: '',
  fields: [
    { credentialKey: 'username', selectors: [] },
    { credentialKey: 'password', selectors: [] },
  ],
  submit: [],
  possibleResults: { success: [] },
};

/**
 * Build the Massad pipeline descriptor.
 * @param options - Scraper options from the user.
 * @returns Pipeline descriptor with OTP phase enabled.
 */
function buildMassadPipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return createPipelineBuilder()
    .withOptions(options)
    .withBrowser()
    .withDeclarativeLogin(MASSAD_LOGIN)
    .withLoginAndOtpTrigger()
    .withLoginAndOptCodeFill()
    .build();
}

export default buildMassadPipeline;
export { buildMassadPipeline };
