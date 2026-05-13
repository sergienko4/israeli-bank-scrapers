/**
 * Bank-specific shape recognisers for the billing-cycle catalog.
 *
 * <p>Each recogniser inspects one pre-nav capture body and emits a
 * canonical {@link IBillingCycleCatalog} {@link some} on match,
 * {@link none} on miss. Recognisers never throw — malformed bodies
 * fall through to {@link none} so the detector can try the next
 * registered shape.
 *
 * <p>Registry is read-only and ordered: {@link SHAPE_RECOGNISERS}
 * lists Backbase first (Amex + Isracard), then Max, then VisaCal.
 * The detector's first-match-wins iteration makes the order
 * deterministic and stable across runs.
 *
 * <p>Adding a new bank shape is an additive registration: write the
 * recogniser pure function and append it to {@link SHAPE_RECOGNISERS}.
 * No changes to existing recognisers, the detector, or the SCRAPE
 * pipeline.
 */

import type { Option } from '../../Types/Option.js';
import { none, some } from '../../Types/Option.js';
import type { IBillingCycle, IBillingCycleCatalog } from '../../Types/PipelineContext.js';

/** JSON scalar subset — what shape probes treat as leaf values. */
type JsonScalar = string | number | boolean | null;

/** JSON array recursion node consumed by the recognisers. */
type JsonArray = readonly JsonValue[];

/** JSON object recursion node — keys are always strings. */
interface IJsonObject {
  readonly [key: string]: JsonValue;
}

/** Full JSON-document algebra used by the recognisers. */
type JsonValue = JsonScalar | JsonArray | IJsonObject;

/** Subset of `IDiscoveredEndpoint` the recognisers read. */
interface IShapeProbeInput {
  readonly responseBody: JsonValue;
}

/**
 * Type guard — narrows {@link JsonValue} to a plain JSON object so
 * recognisers can read named properties without per-key casts.
 *
 * @param value - Candidate JSON node.
 * @returns True when value is a non-null, non-array object.
 */
function isPlainObject(value: JsonValue): value is IJsonObject {
  if (value === null) return false;
  if (typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  return true;
}

/**
 * Type guard — narrows {@link JsonValue} to an array. Used to walk
 * the per-cycle records inside Backbase / Max / VisaCal responses.
 *
 * @param value - Candidate JSON node.
 * @returns True when value is an array (possibly empty).
 */
function isJsonArray(value: JsonValue): value is JsonArray {
  return Array.isArray(value);
}

/**
 * Wrap a typed cycle list as a canonical {@link IBillingCycleCatalog},
 * returning {@link none} when the list is empty. Centralised so
 * every recogniser stays at ≤ 10 lines.
 *
 * @param cycles - Cycles harvested by one recogniser.
 * @returns Some-catalog when the list is non-empty; None otherwise.
 */
function buildCatalog(cycles: readonly IBillingCycle[]): Option<IBillingCycleCatalog> {
  if (cycles.length === 0) return none();
  const catalog: IBillingCycleCatalog = { cycles };
  return some(catalog);
}

/**
 * Read one Backbase cycle entry into the canonical {@link IBillingCycle}
 * shape. Returns {@link none} when required fields are missing or
 * mistyped — malformed entries are skipped, not crashed.
 *
 * @param entry - One element of the `data` array.
 * @returns Some-cycle on match; None on miss.
 */
function readBackbaseEntry(entry: JsonValue): Option<IBillingCycle> {
  if (!isPlainObject(entry)) return none();
  const billingDate = entry.billingDate;
  const isFinal = entry.isFinalBillingDate;
  if (typeof billingDate !== 'string') return none();
  if (typeof isFinal !== 'boolean') return none();
  const cycle: IBillingCycle = { billingDate, isOpen: !isFinal };
  return some(cycle);
}

/** Narrowed shape returned by `isSomeCycle` for downstream `.map(c => c.value)`. */
interface ISomeCycle {
  readonly has: true;
  readonly value: IBillingCycle;
}

/**
 * Type guard — narrows {@link Option}<{@link IBillingCycle}> to the
 * present variant so `.filter` produces a strongly-typed array.
 *
 * @param candidate - Option produced by a per-entry reader.
 * @returns True when the option carries a cycle.
 */
function isSomeCycle(candidate: Option<IBillingCycle>): candidate is ISomeCycle {
  return candidate.has;
}

/**
 * Walk one array of candidate entries through the supplied reader,
 * accumulating only the entries that match. Extracted so each
 * recogniser stays at max-depth = 1 (no inner `if/continue` blocks).
 *
 * @param entries - Source array (typed as JsonArray for safety).
 * @param reader - Per-entry reader returning Option<IBillingCycle>.
 * @returns Harvested cycles.
 */
function harvestCycles(
  entries: JsonArray,
  reader: (entry: JsonValue) => Option<IBillingCycle>,
): readonly IBillingCycle[] {
  const optioned = entries.map(reader);
  const hits = optioned.filter((c): c is ISomeCycle => isSomeCycle(c));
  return hits.map((c): IBillingCycle => c.value);
}

/**
 * Recogniser for the Backbase `GetBillingsForMonthsOverview` shape
 * shared by Amex + Isracard.
 *
 * <p>Match contract: top-level `data` is an array of objects each
 * carrying string `billingDate` and boolean `isFinalBillingDate`.
 * `isOpen` is the inverse of `isFinalBillingDate` — a closed cycle
 * has `isFinalBillingDate=true`.
 *
 * @param input - Pre-nav capture under inspection.
 * @returns Some-catalog when the body matches; None otherwise.
 */
function tryBackbaseShape(input: IShapeProbeInput): Option<IBillingCycleCatalog> {
  const body = input.responseBody;
  if (!isPlainObject(body)) return none();
  const data = body.data;
  if (!isJsonArray(data)) return none();
  const harvested = harvestCycles(data, readBackbaseEntry);
  return buildCatalog(harvested);
}

/**
 * Read one Max `CycleSummary` entry into the canonical shape.
 * Max ships `IsFinnal` (sic — bank-side typo) as the closed-cycle
 * flag; the recogniser normalises that to {@link IBillingCycle.isOpen}.
 *
 * @param entry - One element of the `CycleSummary` array.
 * @returns Some-cycle on match; None on miss.
 */
function readMaxEntry(entry: JsonValue): Option<IBillingCycle> {
  if (!isPlainObject(entry)) return none();
  const date = entry.Date;
  const isFinnal = entry.IsFinnal;
  if (typeof date !== 'string') return none();
  if (typeof isFinnal !== 'boolean') return none();
  const cycle: IBillingCycle = { billingDate: date, isOpen: !isFinnal };
  return some(cycle);
}

/**
 * Pluck the `CycleSummary` array from one card record in
 * `Result.UserCards.Cards[]`. Empty when absent or mistyped.
 *
 * @param card - Candidate card record.
 * @returns The per-card cycle-summary array (empty on miss).
 */
function readMaxCardCycleSummary(card: JsonValue): JsonArray {
  if (!isPlainObject(card)) return [];
  const summary = card.CycleSummary;
  if (!isJsonArray(summary)) return [];
  return summary;
}

/**
 * Walk `Result.UserCards.Cards[*].CycleSummary` to gather every
 * card's cycle rows into one flat array. Max nests cycle data
 * per-card, so the recogniser folds across all cards before
 * deduplication.
 *
 * @param body - Parsed `getHomePageData` response body.
 * @returns Flattened cycle-summary entries across every card.
 */
function readMaxCycleSummary(body: IJsonObject): JsonArray {
  const result = body.Result;
  if (!isPlainObject(result)) return [];
  const userCards = result.UserCards;
  if (!isPlainObject(userCards)) return [];
  const cards = userCards.Cards;
  if (!isJsonArray(cards)) return [];
  return cards.flatMap(readMaxCardCycleSummary);
}

/**
 * Deduplicate harvested cycles by billing date. Max ships one row
 * per currency on the same `Date` — semantically a single cycle —
 * so the recogniser collapses duplicates before publishing.
 *
 * @param cycles - Cycles as read directly from the source array.
 * @returns Cycles with unique `billingDate` values, in first-seen order.
 */
function dedupeByDate(cycles: readonly IBillingCycle[]): readonly IBillingCycle[] {
  const seen = new Set<string>();
  return cycles.filter((cycle): boolean => addIfUnseen(seen, cycle.billingDate));
}

/**
 * Side-effecting helper used by {@link dedupeByDate}'s filter — adds
 * `key` to `seen` and returns true the first time, false thereafter.
 * Extracted so {@link dedupeByDate} stays at max-depth = 1.
 *
 * @param seen - Mutable accumulator of already-seen keys.
 * @param key - Candidate key to track.
 * @returns True when key was newly added; false when already present.
 */
function addIfUnseen(seen: Set<string>, key: string): boolean {
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}

/**
 * Recogniser for Max's `getHomePageData` cycle-summary shape.
 *
 * <p>Max ships one `CycleSummary` row per currency. Rows are
 * semantically the SAME billing cycle, so the recogniser harvests
 * every row then deduplicates by date to emit canonical cycles.
 *
 * @param input - Pre-nav capture under inspection.
 * @returns Some-catalog when the body matches; None otherwise.
 */
function tryMaxShape(input: IShapeProbeInput): Option<IBillingCycleCatalog> {
  const body = input.responseBody;
  if (!isPlainObject(body)) return none();
  const summary = readMaxCycleSummary(body);
  const raw = harvestCycles(summary, readMaxEntry);
  const deduped = dedupeByDate(raw);
  return buildCatalog(deduped);
}

/**
 * Build the open + closed cycle pair for one VisaCal `bigNumbers`
 * entry. The top-level `debitDate` is the NEXT billing date (open
 * cycle still accumulating); `prevDebitDate` is the most recently
 * closed cycle.
 *
 * @param entry - One element of the `bigNumbers` array.
 * @returns Cycles harvested from this entry.
 */
function readVisaCalEntry(entry: JsonValue): readonly IBillingCycle[] {
  if (!isPlainObject(entry)) return [];
  const out: IBillingCycle[] = [];
  const debitDate = entry.debitDate;
  if (typeof debitDate === 'string') out.push({ billingDate: debitDate, isOpen: true });
  const prevDebitDate = entry.prevDebitDate;
  if (typeof prevDebitDate === 'string') out.push({ billingDate: prevDebitDate, isOpen: false });
  return out;
}

/**
 * Flatten the VisaCal bigNumbers array into a single cycle list by
 * concatenating each entry's read result. Extracted so
 * {@link tryVisaCalShape} keeps a flat (max-depth=1) body.
 *
 * @param bigNumbers - Source array.
 * @returns Concatenated cycles.
 */
function flattenVisaCalCycles(bigNumbers: JsonArray): readonly IBillingCycle[] {
  return bigNumbers.flatMap(readVisaCalEntry);
}

/**
 * Recogniser for VisaCal's `getBigNumberAndDetails` shape.
 *
 * <p>Match contract: top-level `result.bigNumbers` is an array of
 * objects carrying `debitDate` (next billing — the OPEN cycle) and
 * optionally `prevDebitDate` (already-billed previous cycle).
 *
 * @param input - Pre-nav capture under inspection.
 * @returns Some-catalog when the body matches; None otherwise.
 */
function tryVisaCalShape(input: IShapeProbeInput): Option<IBillingCycleCatalog> {
  const body = input.responseBody;
  if (!isPlainObject(body)) return none();
  const result = body.result;
  if (!isPlainObject(result)) return none();
  const bigNumbers = result.bigNumbers;
  if (!isJsonArray(bigNumbers)) return none();
  const harvested = flattenVisaCalCycles(bigNumbers);
  return buildCatalog(harvested);
}

/** Strategy registry — order is deterministic, first-match wins. */
const SHAPE_RECOGNISERS: readonly ((input: IShapeProbeInput) => Option<IBillingCycleCatalog>)[] = [
  tryBackbaseShape,
  tryMaxShape,
  tryVisaCalShape,
];

export type { IShapeProbeInput, JsonValue };
export { SHAPE_RECOGNISERS, tryBackbaseShape, tryMaxShape, tryVisaCalShape };
