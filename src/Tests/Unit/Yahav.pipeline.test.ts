/**
 * Yahav pipeline-migration edge tests.
 *
 * Bank-specific quirks the cross-bank suites don't cover: pipeline-first
 * routing (Factory returns a PipelineScraper, not the deleted legacy
 * scraper), the nationalID 3rd-credential concept-map alias, and the
 * no-pre-login/no-OTP declarative login shape.
 */

import { CompanyTypes } from '../../Definitions.js';
import PIPELINE_REGISTRY from '../../Scrapers/Pipeline/Banks/PipelineRegistry.js';
import { YAHAV_LOGIN } from '../../Scrapers/Pipeline/Banks/Yahav/YahavPipeline.js';
import { PipelineScraper } from '../../Scrapers/Pipeline/Core/PipelineScraper.js';
import { WK_CONCEPT_MAP } from '../../Scrapers/Pipeline/Registry/WK/LoginWK.js';
import createScraper from '../../Scrapers/Registry/Factory.js';

const EXPECTED_FIELDS = 3;

describe('Yahav pipeline migration', () => {
  it('routes Yahav through the pipeline registry (no legacy fallback)', () => {
    expect(PIPELINE_REGISTRY[CompanyTypes.Yahav]).toBeDefined();
    const scraper = createScraper({ companyId: CompanyTypes.Yahav, startDate: new Date() });
    expect(scraper).toBeInstanceOf(PipelineScraper);
  });

  it('maps the nationalID 3rd credential to the id-document slot', () => {
    expect(WK_CONCEPT_MAP.nationalID).toBe('nationalId');
  });

  it('declares username/password/nationalID with no OTP', () => {
    const keys = YAHAV_LOGIN.fields.map((f): string => f.credentialKey);
    expect(keys).toEqual(['username', 'password', 'nationalID']);
    expect(keys).toHaveLength(EXPECTED_FIELDS);
  });
});
