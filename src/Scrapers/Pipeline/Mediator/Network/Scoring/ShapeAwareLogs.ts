/**
 * Network Scoring / ShapeAwareLogs — single source of truth for the
 * canonical `discover.shapeAware` structured event. Extracted from
 * `ShapeAware.ts` so the picker stays under the Section 11 150 eff-
 * LoC file cap. The emitter and its payload type live here together
 * so the contract is auditable without crossing module boundaries.
 */

import { getDebug } from '../../../Types/Debug.js';
import { redactUrlFull } from '../../../Types/PiiRedactor.js';
import type { IDiscoveredEndpoint } from '../NetworkDiscoveryTypes.js';

const LOG = getDebug(import.meta.url);

/** Tier label emitted on the canonical `discover.shapeAware` event. */
type ShapeAwareTier =
  | 'none'
  | 'postWithShape'
  | 'replayablePostTxn'
  | 'replayablePost'
  | 'shapePassing'
  | 'preClickFallback'
  | 'urlOnlyMatch'
  | 'windowParamsMatch';

/** Bundled args for {@link logShapeAwarePick} — keeps sig ≤ 100 chars. */
interface IPickLogArgs {
  readonly tier: ShapeAwareTier;
  readonly picked: IDiscoveredEndpoint | false;
  readonly matches: number;
}

/** Pino fields emitted for a picked endpoint (hit case). */
interface IShapeAwareLogFields {
  readonly event: 'discover.shapeAware';
  readonly tier: ShapeAwareTier;
  readonly matches: number;
  readonly picked: string;
  readonly method: string;
  readonly captureIndex: number;
}

/** Picked-endpoint specific Pino fields (subset of {@link IShapeAwareLogFields}). */
type PickedFieldsSubset = Pick<IShapeAwareLogFields, 'picked' | 'method' | 'captureIndex'>;

/**
 * Project the picked-endpoint specific fields. Pulled out of
 * {@link buildPickedLogFields} so the assembler fits the 10-LoC cap.
 * @param picked - Picked discovered endpoint.
 * @returns Bundled `picked` / `method` / `captureIndex` fields.
 */
function pickedFields(picked: IDiscoveredEndpoint): PickedFieldsSubset {
  return {
    picked: redactUrlFull(picked.url),
    method: picked.method,
    captureIndex: picked.captureIndex ?? 0,
  };
}

/**
 * Build the Pino payload for a picked endpoint. Pulled out of
 * {@link logShapeAwarePick} so the emitter fits the 10-LoC cap.
 * @param args - Bundled tier + picked + matches.
 * @returns Bundled fields for the Pino debug line.
 */
function buildPickedLogFields(args: IPickLogArgs): IShapeAwareLogFields {
  const picked = args.picked as IDiscoveredEndpoint;
  const fields = pickedFields(picked);
  return { event: 'discover.shapeAware', tier: args.tier, matches: args.matches, ...fields };
}

/**
 * Emit one canonical structured event per `discoverShapeAware` call.
 * Named fields keep the log queryable; PII-safe via `redactUrlFull`;
 * `captureIndex` bridges the log line to the on-disk capture file.
 * @param args - Bundled tier + picked endpoint + match count.
 * @returns True (placeholder for chaining).
 */
function logShapeAwarePick(args: IPickLogArgs): true {
  if (!args.picked) {
    LOG.debug({ event: 'discover.shapeAware', tier: args.tier, matches: args.matches });
    return true;
  }
  const fields = buildPickedLogFields(args);
  LOG.debug(fields);
  return true;
}

export { logShapeAwarePick };
export type { ShapeAwareTier };
