/**
 * PIPELINE_REGISTRY — the Banks-layer registry of every migrated bank's
 * pipeline factory, merged from the two alphabetical-half sub-registries
 * (split to stay within the max-dependencies limit, mirroring the legacy
 * SCRAPER_REGISTRY composition in `Registry/Factory.ts`).
 *
 * <p>OCP: Core declares only the `PipelineFactory` type and never enumerates
 * banks. Adding a bank touches only `Banks/**` — its folder plus one entry in
 * the appropriate sub-registry. Enforced by the `CoreBankIndependence`
 * architecture test.
 */

import type { CompanyTypes } from '../../../Definitions.js';
import type { PipelineFactory } from '../Core/PipelineDescriptor.js';
import PIPELINE_REGISTRY_AMEX_TO_MAX from './PipelineRegistryAmexToMax.js';
import PIPELINE_REGISTRY_MERCANTILE_TO_VISACAL from './PipelineRegistryMercantileToVisaCal.js';

/** Every migrated bank's pipeline factory, keyed by company id. */
const PIPELINE_REGISTRY: Partial<Record<CompanyTypes, PipelineFactory>> = {
  ...PIPELINE_REGISTRY_AMEX_TO_MAX,
  ...PIPELINE_REGISTRY_MERCANTILE_TO_VISACAL,
};

export default PIPELINE_REGISTRY;
