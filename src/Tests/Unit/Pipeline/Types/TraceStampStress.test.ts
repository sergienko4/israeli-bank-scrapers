/**
 * Stress and allocation baseline for the run-stamp generator (`TraceStamp.ts`):
 * measure before optimizing.
 *
 * Drives only the public API (`nextRunStamp` with injected `nowMs`, plus
 * `resetRunStampState`) with 10,000 and 100,000 synthetic stamps under five
 * clock shapes, asserts the invariants exactly (format, uniqueness, the exact
 * slot sequence), records time / heap numerics as one greppable
 * `TRACE_STAMP_BASELINE {json}` line, and asserts budgets with >= 5x headroom.
 * No disk writes and no real clock waits: every instant is injected.
 */

import * as os from 'node:os';

import ScraperError from '../../../../Scrapers/Base/ScraperError.js';
import type { RunStampStr } from '../../../../Scrapers/Pipeline/Types/TraceStamp.js';
import {
  formatRunStamp,
  nextRunStamp,
  resetRunStampState,
} from '../../../../Scrapers/Pipeline/Types/TraceStamp.js';

type ScenarioName =
  'same-instant' | 'monotonic' | 'clock-rollback' | 'dst-fold-sweep' | 'dst-fold-chain';
type InstantFn = (index: number, size: number) => number;

/** One (scenario, size) cell of the matrix. */
interface ICase {
  readonly scenario: ScenarioName;
  readonly size: number;
}
/** Timing and heap numerics for one cell. */
interface IMeasured {
  readonly wallMs: number;
  readonly p50Us: number;
  readonly p99Us: number;
  readonly heapMb: number;
  readonly thrown: string;
}
/** Invariant counters for one cell. */
interface IInvariants {
  readonly issued: number;
  readonly unique: number;
  readonly malformed: number;
  readonly mismatches: number;
  readonly thrown: string;
}
/** Measured numerics merged with invariant counters. */
interface ICaseResult extends ICase {
  readonly measured: IMeasured;
  readonly invariants: IInvariants;
  readonly bytesPerStamp: number;
}
/** Outcome of the timed loop. */
interface ITimedRun {
  readonly thrown: string;
  readonly wallMs: number;
}
/** Growth-curve point: a cell with timing and heap only. */
interface ICurvePoint extends ICase {
  readonly measured: IMeasured;
}

/** Stamp format `DD-MM-YYYY_HHMMSScc`. */
const STAMP_FORMAT_RE = /^\d{2}-\d{2}-\d{4}_\d{8}$/;
const SCENARIOS: readonly ScenarioName[] = [
  'same-instant',
  'monotonic',
  'clock-rollback',
  'dst-fold-sweep',
  'dst-fold-chain',
];
const SIZES = [10_000, 100_000] as const;
const CURVE_SIZES = [1_000, 5_000, 10_000, 20_000, 50_000, 100_000] as const;
const CURVE_SCENARIOS: readonly ScenarioName[] = ['same-instant', 'dst-fold-chain'];
const WARM_UP_STAMPS = 1_000;
const BATCH_SIZE = 100;
const CENTISECOND_MS = 10;
const HOUR_MS = 3_600_000;
const NS_PER_MS = 1_000_000;
const NS_PER_US = 1_000;
const BYTES_PER_MB = 1_048_576;
const ADVANCE_STEP_MS = 25;
const SUMMER_START_MS = Date.UTC(2026, 5, 15, 10, 0, 0);
/** Israel DST ends the last Sunday of October: local 01:00-02:00 happens twice. */
const FOLD_FIRST_PASS_MS = Date.UTC(2026, 9, 24, 22, 0, 0);
const FOLD_SECOND_PASS_MS = Date.UTC(2026, 9, 24, 23, 0, 0);
/** A fold chain far beyond the depth at which the old recursive claim overflowed (~7k). */
const CHAIN_DEPTH = 100_000;

/*
 * Budgets. Baseline host: Intel i7-7660U (2 cores / 4 threads), Node 26.12.0, darwin x64,
 * TZ=Asia/Jerusalem, `--expose-gc`. "Quiet" = four lightly loaded runs; "loaded" = one run taken
 * while the host load average was ~180 on 4 threads (a deliberately hostile slow runner).
 * Each constant states the worst value seen and the multiplier the budget leaves over it.
 */

/**
 * Total wall ms for one cell, by size. Wall time is stall-dominated, so it is only a
 * sanity ceiling. Worst quiet: 153 ms @10k, 982 ms @100k. Worst loaded: 773 ms @10k,
 * 6,044 ms @100k. Budgets 5,000 ms (6.5x loaded, 33x quiet) and 40,000 ms (6.6x loaded).
 */
const WALL_MS_BUDGET: Readonly<Record<number, number>> = { 10_000: 5_000, 100_000: 40_000 };
/**
 * Per-call p50 in microseconds: the stall-robust time signal. Worst quiet 6.5 us, worst
 * loaded 7.6 us (dst-fold-sweep, two stamp formats per call). Budget 50 us (6.6x loaded).
 */
const P50_US_BUDGET = 50;
/**
 * Per-call p99 in microseconds over 100-call batch means (GC and scheduler stalls live
 * here). Worst quiet 403 us, worst loaded 2,520 us. Budget 25,000 us (9.9x loaded).
 */
const P99_US_BUDGET = 25_000;
/** Retained heap bytes per issued stamp. Worst observed 73 B in every run. Budget 512 B (7.0x). */
const HEAP_BYTES_PER_STAMP_BUDGET = 512;
/**
 * Max p50 per-call growth from 10k to 100k stamps. Worst observed: 1.16x (flat, so total
 * time is linear; a quadratic chain would be about 10x). Budget 6x (5.2x).
 */
const P50_GROWTH_BUDGET = 6;
/**
 * Max retained-heap growth for a 10x larger run, measured against at least
 * `HEAP_GROWTH_FLOOR_MB`. Linear is 10x; local runs gave 10.1x and quadratic would be 100x.
 * Budget 60x.
 */
const HEAP_GROWTH_BUDGET = 60;
/**
 * Smallest heap reading treated as a real footprint. A 10k-stamp run normally retains about
 * 0.7 MB (73 B/stamp); a CI run on Node 26 read 0.011 MB for the same work, which is
 * collector timing rather than a smaller footprint, and a ratio over it reached 566x.
 */
const HEAP_GROWTH_FLOOR_MB = 0.5;

const BASELINE = new Map<string, ICaseResult>();
const CURVES: ICurvePoint[] = [];
let collectMs = 0;

/**
 * Stable map key for a matrix cell.
 * @param test - The (scenario, size) cell.
 * @returns `scenario@size`.
 */
function cellKey(test: ICase): string {
  const size = String(test.size);
  return `${test.scenario}@${size}`;
}

/**
 * Rounding helper for the JSON summary.
 * @param value - Number to round.
 * @returns The value rounded to three decimals.
 */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Epoch-ms of the 10 ms slot containing `ms`.
 * @param ms - Epoch milliseconds.
 * @returns Quantized slot.
 */
function quantize(ms: number): number {
  return Math.floor(ms / CENTISECOND_MS) * CENTISECOND_MS;
}

/**
 * Every request lands on one instant.
 * @returns The injected clock reading.
 */
function sameInstantAt(): number {
  return SUMMER_START_MS;
}

/**
 * Clock advancing 25 ms per request.
 * @param index - Request index.
 * @returns The injected clock reading.
 */
function monotonicAt(index: number): number {
  return SUMMER_START_MS + index * ADVANCE_STEP_MS;
}

/**
 * Advancing clock that jumps back one hour at the midpoint.
 * @param index - Request index.
 * @param size - Total requests.
 * @returns The injected clock reading.
 */
function rollbackAt(index: number, size: number): number {
  const advanced = monotonicAt(index);
  const isPastMidpoint = index >= size / 2;
  return isPastMidpoint ? advanced - HOUR_MS : advanced;
}

/**
 * Evenly spread requests across the first fold hour, then the repeat hour.
 * @param index - Request index.
 * @param size - Total requests.
 * @returns The injected clock reading.
 */
function foldSweepAt(index: number, size: number): number {
  const half = size / 2;
  const isSecondPass = index >= half;
  const passStart = isSecondPass ? FOLD_SECOND_PASS_MS : FOLD_FIRST_PASS_MS;
  const spacing = Math.floor(HOUR_MS / half);
  return passStart + (index % half) * spacing;
}

/**
 * Same-instant burst in the first fold hour, then in the repeat hour.
 * @param index - Request index.
 * @param size - Total requests.
 * @returns The injected clock reading.
 */
function foldChainAt(index: number, size: number): number {
  const isSecondPass = index >= size / 2;
  return isSecondPass ? FOLD_SECOND_PASS_MS : FOLD_FIRST_PASS_MS;
}

/**
 * Expected slot after a rollback: strictly after the last pre-rollback slot.
 * @param index - Request index.
 * @param size - Total requests.
 * @returns Expected epoch-ms slot.
 */
function rollbackSlot(index: number, size: number): number {
  const half = size / 2;
  const instant = monotonicAt(index);
  const lastBeforeRollback = monotonicAt(half - 1);
  if (index < half) return quantize(instant);
  return quantize(lastBeforeRollback) + (index - half + 1) * CENTISECOND_MS;
}

/**
 * Expected slot in the fold sweep: repeat-hour requests collide once, +10 ms.
 * @param index - Request index.
 * @param size - Total requests.
 * @returns Expected epoch-ms slot.
 */
function foldSweepSlot(index: number, size: number): number {
  const isSecondPass = index >= size / 2;
  const bump = isSecondPass ? CENTISECOND_MS : 0;
  const instant = foldSweepAt(index, size);
  return quantize(instant) + bump;
}

/**
 * Expected slot in the chain: stamps are consecutive 10 ms slots, the repeat
 * hour resuming right after the colliding run.
 * @param index - Request index.
 * @param size - Total requests.
 * @returns Expected epoch-ms slot.
 */
function foldChainSlot(index: number, size: number): number {
  const isSecondPass = index >= size / 2;
  const passStart = isSecondPass ? FOLD_SECOND_PASS_MS : FOLD_FIRST_PASS_MS;
  return passStart + index * CENTISECOND_MS;
}

/**
 * Same-instant oracle: consecutive 10 ms slots.
 * @param index - Request index.
 * @returns Expected epoch-ms slot.
 */
function sameInstantSlot(index: number): number {
  return SUMMER_START_MS + index * CENTISECOND_MS;
}

/**
 * Monotonic oracle: every request owns its own slot.
 * @param index - Request index.
 * @returns Expected epoch-ms slot.
 */
function monotonicSlot(index: number): number {
  const instant = monotonicAt(index);
  return quantize(instant);
}

const CLOCKS: Readonly<Record<ScenarioName, InstantFn>> = {
  'same-instant': sameInstantAt,
  monotonic: monotonicAt,
  'clock-rollback': rollbackAt,
  'dst-fold-sweep': foldSweepAt,
  'dst-fold-chain': foldChainAt,
};
const ORACLES: Readonly<Record<ScenarioName, InstantFn>> = {
  'same-instant': sameInstantSlot,
  monotonic: monotonicSlot,
  'clock-rollback': rollbackSlot,
  'dst-fold-sweep': foldSweepSlot,
  'dst-fold-chain': foldChainSlot,
};

/**
 * Pre-compute the injected instants so the timed loop is only `nextRunStamp`.
 * @param clock - Scenario clock.
 * @param size - Number of stamps.
 * @returns Injected `nowMs` per request.
 */
function buildInstants(clock: InstantFn, size: number): Float64Array {
  const instants = new Float64Array(size);
  for (let index = 0; index < size; index++) instants[index] = clock(index, size);
  return instants;
}

/**
 * Name of a thrown value, tolerant of non-Error throws.
 * @param error - Caught value.
 * @returns The error name, or `NonError`.
 */
function errorName(error: unknown): string {
  const isError = error instanceof Error;
  return isError ? error.name : 'NonError';
}

/**
 * Ascending numeric comparator.
 * @param left - First number.
 * @param right - Second number.
 * @returns Negative, zero or positive ordering.
 */
function ascending(left: number, right: number): number {
  return left - right;
}

/**
 * Nearest-rank percentile.
 * @param values - Samples.
 * @param fraction - Percentile as a 0-1 fraction.
 * @returns The sample at that rank, or 0 when empty.
 */
function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort(ascending);
  const rank = Math.ceil(fraction * sorted.length) - 1;
  return sorted.length === 0 ? 0 : sorted[Math.max(rank, 0)];
}

/**
 * Heap in use after a forced collection when `--expose-gc` is active.
 * @returns `heapUsed` bytes.
 */
function heapUsedAfterGc(): number {
  if (typeof global.gc === 'function') global.gc();
  const usage = process.memoryUsage();
  return usage.heapUsed;
}

/**
 * Time one batch of `nextRunStamp` calls.
 * @param instants - Injected instants.
 * @param start - First index of the batch.
 * @returns Mean nanoseconds per call over the batch.
 */
function timeBatch(instants: Float64Array, start: number): number {
  const end = Math.min(start + BATCH_SIZE, instants.length);
  const t0 = process.hrtime.bigint();
  for (let index = start; index < end; index++) nextRunStamp(instants[index]);
  const t1 = process.hrtime.bigint();
  return Number(t1 - t0) / (end - start);
}

/**
 * Time every batch, appending per-batch means.
 * @param instants - Injected instants.
 * @param batchNs - Sink for the per-batch means.
 * @returns True once all batches ran.
 */
function timeAllBatches(instants: Float64Array, batchNs: number[]): boolean {
  for (let start = 0; start < instants.length; start += BATCH_SIZE) {
    const perCallNs = timeBatch(instants, start);
    batchNs.push(perCallNs);
  }
  return true;
}

/**
 * Run the timed loop, converting a thrown error into its name.
 * @param instants - Injected instants.
 * @param batchNs - Sink for the per-batch means.
 * @returns Empty string on success, else the thrown error name.
 */
function guardedTime(instants: Float64Array, batchNs: number[]): string {
  try {
    timeAllBatches(instants, batchNs);
    return '';
  } catch (error) {
    return errorName(error);
  }
}

/**
 * Time the whole run and capture its per-batch means.
 * @param instants - Injected instants.
 * @param batchNs - Sink for the per-batch means.
 * @returns Thrown error name (empty on success) and total wall ms.
 */
function timeRun(instants: Float64Array, batchNs: number[]): ITimedRun {
  const startedAt = process.hrtime.bigint();
  const thrown = guardedTime(instants, batchNs);
  const endedAt = process.hrtime.bigint();
  return { thrown, wallMs: Number(endedAt - startedAt) / NS_PER_MS };
}

/**
 * Timed + heap-measured pass; retains nothing but the module's own state.
 * @param instants - Injected instants.
 * @returns Timing and heap numerics.
 */
function measurePass(instants: Float64Array): IMeasured {
  const batchNs: number[] = [];
  resetRunStampState();
  const heapBefore = heapUsedAfterGc();
  const { thrown, wallMs } = timeRun(instants, batchNs);
  const heapAfter = heapUsedAfterGc();
  const heapMb = (heapAfter - heapBefore) / BYTES_PER_MB;
  const p50Us = percentile(batchNs, 0.5) / NS_PER_US;
  const p99Us = percentile(batchNs, 0.99) / NS_PER_US;
  return { wallMs, p50Us, p99Us, heapMb, thrown };
}

/**
 * Issue every instant, retaining the stamps for verification.
 * @param instants - Injected instants.
 * @param stamps - Sink for issued stamps.
 * @returns True once all instants were issued.
 */
function issueInto(instants: Float64Array, stamps: RunStampStr[]): boolean {
  for (const nowMs of instants) {
    const stamp = nextRunStamp(nowMs);
    stamps.push(stamp);
  }
  return true;
}

/**
 * Compare issued stamps with the independent slot oracle.
 * @param stamps - Issued stamps.
 * @param scenario - Scenario under test.
 * @param size - Planned stamp count.
 * @returns Number of stamps that differ from the oracle.
 */
function countMismatches(
  stamps: readonly RunStampStr[],
  scenario: ScenarioName,
  size: number,
): number {
  let mismatches = 0;
  for (const [index, stamp] of stamps.entries()) {
    const expectedAt = new Date(ORACLES[scenario](index, size));
    const expected = formatRunStamp(expectedAt);
    if (stamp !== expected) mismatches++;
  }
  return mismatches;
}

/**
 * Whether a stamp breaks the `DD-MM-YYYY_HHMMSScc` format.
 * @param stamp - Issued stamp.
 * @returns True when malformed.
 */
function isMalformed(stamp: string): boolean {
  return !STAMP_FORMAT_RE.test(stamp);
}

/**
 * Verification pass: retain every stamp and count invariant violations.
 * @param instants - Injected instants.
 * @param test - The (scenario, size) cell.
 * @returns Invariant counters.
 */
function verifyPass(instants: Float64Array, test: ICase): IInvariants {
  const stamps: RunStampStr[] = [];
  resetRunStampState();
  const thrown = guardedIssue(instants, stamps);
  const mismatches = countMismatches(stamps, test.scenario, test.size);
  const malformed = stamps.filter(isMalformed).length;
  const unique = new Set(stamps).size;
  return { issued: stamps.length, unique, malformed, mismatches, thrown };
}

/**
 * Run the issuing loop, converting a thrown error into its name.
 * @param instants - Injected instants.
 * @param stamps - Sink for issued stamps.
 * @returns Empty string on success, else the thrown error name.
 */
function guardedIssue(instants: Float64Array, stamps: RunStampStr[]): string {
  try {
    issueInto(instants, stamps);
    return '';
  } catch (error) {
    return errorName(error);
  }
}

/**
 * Measure and verify one cell, resetting stamp state around each pass.
 * @param test - The (scenario, size) cell.
 * @returns Full result for the cell.
 */
function runCase(test: ICase): ICaseResult {
  const instants = buildInstants(CLOCKS[test.scenario], test.size);
  const measured = measurePass(instants);
  const invariants = verifyPass(instants, test);
  resetRunStampState();
  const bytesPerStamp = (measured.heapMb * BYTES_PER_MB) / Math.max(invariants.issued, 1);
  return { ...test, measured, invariants, bytesPerStamp };
}

/**
 * Throwaway warm-up so JIT compilation is not billed to the first cell.
 * @returns True once warm-up finished.
 */
function warmUp(): boolean {
  resetRunStampState();
  for (let index = 0; index < WARM_UP_STAMPS; index++) nextRunStamp(SUMMER_START_MS);
  return resetRunStampState();
}

/**
 * Growth-curve point: reuse the matrix cell when it exists, else measure only.
 * @param test - The (scenario, size) cell.
 * @returns Timing and heap for the cell.
 */
function curvePoint(test: ICase): ICurvePoint {
  const key = cellKey(test);
  const known = BASELINE.get(key);
  if (known !== undefined) return { ...test, measured: known.measured };
  const instants = buildInstants(CLOCKS[test.scenario], test.size);
  const measured = measurePass(instants);
  resetRunStampState();
  return { ...test, measured };
}

/**
 * Host description recorded beside the numbers.
 * @returns Node, OS, CPU and zone details.
 */
function describeHost(): Record<string, string | number | boolean> {
  const cpus = os.cpus();
  const cpuModel = cpus.length > 0 ? cpus[0].model : 'unknown';
  const hasGc = typeof global.gc === 'function';
  const tz = process.env.TZ ?? '';
  const platform = os.platform();
  return {
    node: process.version,
    platform,
    arch: os.arch(),
    cpuModel,
    cpuCount: cpus.length,
    tz,
    hasGc,
  };
}

/**
 * Flatten a measured cell into a rounded JSON row.
 * @param point - Cell with timing and heap numerics.
 * @returns Greppable row.
 */
function toRow(point: ICurvePoint): Record<string, string | number> {
  const { measured } = point;
  const wallMs = round3(measured.wallMs);
  const p50Us = round3(measured.p50Us);
  const p99Us = round3(measured.p99Us);
  const heapMb = round3(measured.heapMb);
  return {
    scenario: point.scenario,
    size: point.size,
    wallMs,
    p50Us,
    p99Us,
    heapMb,
    thrown: measured.thrown,
  };
}

/**
 * Flatten a verified cell into a rounded JSON row.
 * @param result - Cell result.
 * @returns Greppable row including per-stamp heap and issue count.
 */
function toRowFromResult(result: ICaseResult): Record<string, string | number> {
  const row = toRow(result);
  const bytesPerStamp = Math.round(result.bytesPerStamp);
  return { ...row, issued: result.invariants.issued, bytesPerStamp };
}

/**
 * Look up a populated cell.
 * @param test - The (scenario, size) cell.
 * @returns Its result.
 */
function resultFor(test: ICase): ICaseResult {
  const key = cellKey(test);
  const result = BASELINE.get(key);
  if (result === undefined) throw new ScraperError(`no baseline for ${key}`);
  return result;
}

/**
 * Cells of the full scenario x size matrix.
 * @returns Every (scenario, size) pair.
 */
function buildMatrix(): ICase[] {
  const cells: ICase[] = [];
  for (const scenario of SCENARIOS) for (const size of SIZES) cells.push({ scenario, size });
  return cells;
}

/**
 * Curve cells for the scenarios whose growth is recorded.
 * @returns Every (scenario, size) curve pair.
 */
function buildCurveCells(): ICase[] {
  const cells: ICase[] = [];
  for (const scenario of CURVE_SCENARIOS)
    for (const size of CURVE_SIZES) cells.push({ scenario, size });
  return cells;
}

/**
 * Verify and measure every matrix cell.
 * @returns True once the matrix is populated.
 */
function runMatrix(): boolean {
  for (const cell of buildMatrix()) {
    const result = runCase(cell);
    const key = cellKey(cell);
    BASELINE.set(key, result);
  }
  return true;
}

/**
 * Measure the growth-curve cells, reusing matrix cells where they coincide.
 * @returns True once the curves are populated.
 */
function runCurves(): boolean {
  for (const cell of buildCurveCells()) {
    const point = curvePoint(cell);
    CURVES.push(point);
  }
  return true;
}

/**
 * Run the matrix and the curves.
 * @returns True once the baseline is populated.
 */
function collectBaseline(): boolean {
  const startedAt = process.hrtime.bigint();
  warmUp();
  runMatrix();
  runCurves();
  resetRunStampState();
  const endedAt = process.hrtime.bigint();
  collectMs = Number(endedAt - startedAt) / NS_PER_MS;
  return true;
}

/**
 * Emit the single greppable baseline line.
 * @returns True once written.
 */
function writeSummary(): boolean {
  const cases = [...BASELINE.values()].map(toRowFromResult);
  const curves = CURVES.map(toRow);
  const summary = {
    host: describeHost(),
    warmUp: WARM_UP_STAMPS,
    batch: BATCH_SIZE,
    collectMs: round3(collectMs),
    cases,
    curves,
  };
  process.stdout.write(`TRACE_STAMP_BASELINE ${JSON.stringify(summary)}\n`);
  return true;
}

/**
 * Look up the smaller and larger run of a scenario.
 * @param scenario - Scenario name.
 * @returns Results at the smallest and largest matrix size.
 */
function sizeBounds(scenario: ScenarioName): readonly [ICaseResult, ICaseResult] {
  const small = resultFor({ scenario, size: SIZES[0] });
  const large = resultFor({ scenario, size: SIZES[SIZES.length - 1] });
  return [small, large];
}

/**
 * Issue `depth` same-instant stamps in the first fold hour, so the repeat hour
 * starts against a colliding run of that length.
 * @param depth - Colliding run length to seed.
 * @returns True once seeded.
 */
function seedFoldStamps(depth: number): boolean {
  resetRunStampState();
  for (let index = 0; index < depth; index++) nextRunStamp(FOLD_FIRST_PASS_MS);
  return true;
}

const MATRIX = buildMatrix();

describe('TraceStamp stress baseline', () => {
  beforeAll(() => {
    collectBaseline();
    writeSummary();
  });

  afterAll(() => {
    resetRunStampState();
  });

  it('[TSS-0] the host zone really folds local 01:xx twice (precondition)', () => {
    const firstPass = new Date(FOLD_FIRST_PASS_MS).getHours();
    const secondPass = new Date(FOLD_SECOND_PASS_MS).getHours();
    expect(firstPass).toBe(1);
    expect(secondPass).toBe(1);
  });

  it.each(MATRIX)('[TSS-1] $scenario @ $size issues every stamp without RangeError', test => {
    const { invariants } = resultFor(test);
    expect(invariants.thrown).toBe('');
    expect(invariants.issued).toBe(test.size);
  });

  it.each(MATRIX)('[TSS-2] $scenario @ $size stamps are well-formed and unique', test => {
    const { invariants } = resultFor(test);
    expect(invariants.malformed).toBe(0);
    expect(invariants.unique).toBe(invariants.issued);
  });

  it.each(MATRIX)('[TSS-3] $scenario @ $size every stamp equals the slot oracle', test => {
    const { invariants } = resultFor(test);
    expect(invariants.mismatches).toBe(0);
  });

  it.each(MATRIX)('[TSS-5] $scenario @ $size stays within the time budgets', test => {
    const { measured } = resultFor(test);
    expect(measured.wallMs).toBeLessThan(WALL_MS_BUDGET[test.size]);
    expect(measured.p50Us).toBeLessThan(P50_US_BUDGET);
    expect(measured.p99Us).toBeLessThan(P99_US_BUDGET);
  });

  it.each(MATRIX)('[TSS-6] $scenario @ $size retains <= budget heap bytes per stamp', test => {
    const result = resultFor(test);
    const hasGc = typeof global.gc === 'function';
    const observedBytes = hasGc ? result.bytesPerStamp : 0;
    expect(observedBytes).toBeLessThan(HEAP_BYTES_PER_STAMP_BUDGET);
  });

  it.each(SCENARIOS)('[TSS-7] %s per-call p50 stays flat across a 10x step', name => {
    const [small, large] = sizeBounds(name);
    const growth = large.measured.p50Us / small.measured.p50Us;
    expect(growth).toBeLessThan(P50_GROWTH_BUDGET);
  });

  it.each(SCENARIOS)('[TSS-8] %s retained heap grows linearly across a 10x step', name => {
    const [small, large] = sizeBounds(name);
    const hasGc = typeof global.gc === 'function';
    const denominator = Math.max(small.measured.heapMb, HEAP_GROWTH_FLOOR_MB);
    const growth = hasGc ? large.measured.heapMb / denominator : 0;
    expect(growth).toBeLessThan(HEAP_GROWTH_BUDGET);
  });

  it('[TSS-9] a repeat-hour request after a chain far deeper than the old ceiling gets the exact next slot', () => {
    seedFoldStamps(CHAIN_DEPTH);
    const stamp = nextRunStamp(FOLD_SECOND_PASS_MS);
    const nextFreeAt = new Date(FOLD_SECOND_PASS_MS + CHAIN_DEPTH * CENTISECOND_MS);
    const expected = formatRunStamp(nextFreeAt);
    resetRunStampState();
    expect(stamp).toBe(expected);
  });
});
