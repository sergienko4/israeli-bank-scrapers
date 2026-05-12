/**
 * Cross-bank billing-cycle catalog detector — invoked by
 * ACCOUNT-RESOLVE.POST against the pre-nav network buffer.
 *
 * <p>Backed by a Strategy registry of shape recognisers
 * ({@link SHAPE_RECOGNISERS}). Each recogniser inspects one capture's
 * response body and emits a canonical {@link IBillingCycleCatalog}
 * when it identifies a known bank-specific cycle shape. Recognisers
 * run in registration order — the first hit wins, deterministically.
 *
 * <p>Default-deny: when no recogniser matches any capture, returns
 * {@link none}. Downstream SCRAPE then falls back to month-chunk
 * iteration. Adding a new bank's shape is an additive registration
 * step in {@link BillingCycleCatalogShapes} — never a branch here.
 */

import { isSome, none, type Option } from '../../Types/Option.js';
import type { IBillingCycleCatalog } from '../../Types/PipelineContext.js';
import { type JsonValue, SHAPE_RECOGNISERS } from './BillingCycleCatalogShapes.js';

type CatalogOption = Option<IBillingCycleCatalog>;

/**
 * Minimal pre-nav capture shape the detector consumes.
 *
 * <p>Mirrors the field names of `IDiscoveredEndpoint` so a pool from
 * `MediatorNetwork.getPreNavCaptures()` is structurally assignable.
 * The `responseBody` arrives as `unknown` from the network surface;
 * the detector narrows it to {@link JsonValue} at the call boundary
 * before handing it to typed recognisers.
 */
interface IPreNavCapture {
  readonly url: string;
  readonly responseBody: unknown;
}

/**
 * Fold one recogniser invocation into the accumulator. Short-circuits
 * by keeping the first {@link some} hit; otherwise tries the next
 * recogniser with the supplied body.
 *
 * @param accumulator - Result accumulated by prior recognisers.
 * @param recogniser - Next shape recogniser in the registry.
 * @param body - Capture body, already narrowed to JsonValue.
 * @returns The accumulated hit, or the recogniser's output.
 */
function foldRecogniser(
  accumulator: CatalogOption,
  recogniser: (input: { readonly responseBody: JsonValue }) => CatalogOption,
  body: JsonValue,
): CatalogOption {
  if (isSome(accumulator)) return accumulator;
  return recogniser({ responseBody: body });
}

/**
 * Try every registered shape recogniser against a single capture
 * via a left-fold. First-match-wins.
 *
 * @param capture - One pre-nav capture to probe.
 * @returns Some-catalog from the first matching recogniser; None
 *   when no recogniser claims the capture.
 */
function probeOne(capture: IPreNavCapture): CatalogOption {
  const body: JsonValue = capture.responseBody as JsonValue;
  const seed: CatalogOption = none();
  return SHAPE_RECOGNISERS.reduce<CatalogOption>(
    (acc, recogniser): CatalogOption => foldRecogniser(acc, recogniser, body),
    seed,
  );
}

/**
 * Fold one capture probe into the accumulator. Keeps the first
 * {@link some} hit so the detector short-circuits across the buffer.
 *
 * @param accumulator - Result accumulated by prior captures.
 * @param capture - Next capture in the buffer.
 * @returns The accumulated hit, or the new capture's probe result.
 */
function foldCapture(accumulator: CatalogOption, capture: IPreNavCapture): CatalogOption {
  if (isSome(accumulator)) return accumulator;
  return probeOne(capture);
}

/**
 * Walk the pre-nav capture buffer searching for a known
 * cycle-catalog shape across all registered recognisers.
 *
 * @param buffer - Snapshot of pre-nav captures emitted by
 *   `MediatorNetwork.getPreNavCaptures`.
 * @returns An Option carrying the canonical catalog when a recogniser
 *   matches any capture; {@link none} when the buffer carries no
 *   recognised shape.
 */
function detectBillingCycleCatalog(buffer: readonly IPreNavCapture[]): CatalogOption {
  const seed: CatalogOption = none();
  return buffer.reduce<CatalogOption>(
    (acc, capture): CatalogOption => foldCapture(acc, capture),
    seed,
  );
}

export type { IPreNavCapture };
export { detectBillingCycleCatalog };
