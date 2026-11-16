/**
 * PIPELINE_REGISTRY — the Banks-layer registry of every migrated bank's
 * pipeline factory, built from the one bank pipeline table.
 *
 * <p>OCP: Core declares only the `PipelineFactory` type and never enumerates
 * banks. Adding a bank touches only `Banks/**` — its folder plus one entry in
 * a table shard. Enforced by the `CoreBankIndependence` architecture test.
 */

import { type CompanyTypes } from '../../../Definitions.js';
import type { PipelineFactory } from '../Core/PipelineDescriptor.js';
import BANK_PIPELINE_TABLE from './BankPipelineTable.js';
import { type IBankPipelineEntry, pipelineFactoryOf } from './PipelineTableBuilder.js';

/**
 * Build the factory registry from the table, preserving the bank keys.
 * @param table - The bank pipeline table.
 * @returns Every entry's factory, keyed by bank.
 */
function registryOf(
  table: Partial<Record<CompanyTypes, IBankPipelineEntry>>,
): Partial<Record<CompanyTypes, PipelineFactory>> {
  const entries = Object.entries(table).map(([bank, entry]) => [bank, pipelineFactoryOf(entry)]);
  return Object.fromEntries(entries) as Partial<Record<CompanyTypes, PipelineFactory>>;
}

/** Every migrated bank's pipeline factory, keyed by company id. */
const PIPELINE_REGISTRY = registryOf(BANK_PIPELINE_TABLE);

export default PIPELINE_REGISTRY;
