/**
 * Generic builder for the one bank pipeline table. A bank entry is its
 * api-direct call config, its scrape shape, and an optional pre-build gate;
 * every bank previously repeated this same builder chain in a `*Pipeline.ts`
 * wrapper.
 */

import type { ScraperOptions } from '../../Base/Interface.js';
import createPipelineBuilder from '../Core/Builder/PipelineBuilderFactory.js';
import type { IPipelineDescriptor, PipelineFactory } from '../Core/PipelineDescriptor.js';
import type { IApiDirectCallConfig } from '../Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { IApiDirectScrapeShape } from '../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { Procedure } from '../Types/Procedure.js';

/** A pre-build check; a failure stops the pipeline before any request. */
type PipelineGate = (options: ScraperOptions) => Procedure<true>;

/** The type-erased shape a table entry stores. */
type AnyShape = IApiDirectScrapeShape<unknown, unknown>;

/** One bank's pipeline data and optional gate. */
interface IBankPipelineEntry {
  readonly config: IApiDirectCallConfig;
  readonly shape: AnyShape;
  readonly gate?: PipelineGate;
}

/**
 * Build one table entry, erasing the shape's account/cursor parameters.
 * @param config - Bank api-direct call config.
 * @param shape - Bank scrape shape.
 * @param gate - Optional pre-build check.
 * @returns The table entry.
 */
function bankEntry<TAcct, TCursor>(
  config: IApiDirectCallConfig,
  shape: IApiDirectScrapeShape<TAcct, TCursor>,
  gate?: PipelineGate,
): IBankPipelineEntry {
  return { config, shape: shape as unknown as AnyShape, gate };
}

/**
 * Run a table entry's optional gate.
 * @param entry - Bank pipeline entry.
 * @param options - Scraper options from the user.
 * @returns The gate verdict, or false when the entry has no gate.
 */
function gateVerdict(entry: IBankPipelineEntry, options: ScraperOptions): Procedure<true> | false {
  const gate = entry.gate;
  return gate === undefined ? false : gate(options);
}

/**
 * Build the descriptor from one table entry, without running its gate.
 * @param entry - Bank pipeline entry.
 * @param options - Scraper options from the user.
 * @returns Pipeline descriptor, or a builder failure.
 */
function buildDescriptor(
  entry: IBankPipelineEntry,
  options: ScraperOptions,
): Procedure<IPipelineDescriptor> {
  return createPipelineBuilder()
    .withOptions(options)
    .withApiDirect(entry.config, entry.shape)
    .build();
}

/**
 * Build one bank's descriptor from its table entry.
 * @param entry - Bank pipeline entry.
 * @param options - Scraper options from the user.
 * @returns Pipeline descriptor, or the gate's failure.
 */
function buildPipelineFromEntry(
  entry: IBankPipelineEntry,
  options: ScraperOptions,
): Procedure<IPipelineDescriptor> {
  const verdict = gateVerdict(entry, options);
  if (verdict !== false && !verdict.success) return verdict;
  return buildDescriptor(entry, options);
}

/**
 * Turn one table entry into the factory the registry exposes.
 * @param entry - Bank pipeline entry.
 * @returns A pipeline factory for that bank.
 */
function pipelineFactoryOf(entry: IBankPipelineEntry): PipelineFactory {
  return (options: ScraperOptions): Procedure<IPipelineDescriptor> =>
    buildPipelineFromEntry(entry, options);
}

export type { IBankPipelineEntry };
export { bankEntry, pipelineFactoryOf };
