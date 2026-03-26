/**
 * Amex metadata extractor — pure config shell.
 *
 * This file is a CONFIG PROVIDER only. Zero parsing logic.
 * All discovery: DynamicMetadataMapper.extract()
 * All key aliases: PIPELINE_WELL_KNOWN_TXN_FIELDS (the canonical WK dictionary)
 *
 * To adapt Amex to a new API structure:
 *   1. Update PIPELINE_WELL_KNOWN_TXN_FIELDS in PipelineWellKnown.ts
 *   2. This file requires no changes.
 */

import {
  PIPELINE_WELL_KNOWN_RESPONSE_FIELDS,
  PIPELINE_WELL_KNOWN_TXN_FIELDS,
} from '../../Registry/PipelineWellKnown.js';
import type { Procedure } from '../../Types/Procedure.js';
import { extract, type IWkAccount } from '../Isracard/DynamicMetadataMapper.js';

const WK = { ...PIPELINE_WELL_KNOWN_TXN_FIELDS, ...PIPELINE_WELL_KNOWN_RESPONSE_FIELDS };

/** Amex card account — WK-aligned field names (queryId, displayId, processedDate). */
export type IAmexCardAccount = IWkAccount;

/**
 * Extract Amex card accounts from a raw DashboardMonth API response.
 * 100% dynamic — no hardcoded keys anywhere in this call chain.
 * @param raw - Raw API response.
 * @returns Procedure with dynamically discovered card accounts.
 */
export function extractAmexAccounts(
  raw: Record<string, unknown>,
): Procedure<readonly IAmexCardAccount[]> {
  return extract(raw, WK);
}
