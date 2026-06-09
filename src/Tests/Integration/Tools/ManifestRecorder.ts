/**
 * Mode B harvest auxiliary — dumps the full live response buffer to
 * a per-bank `manifest-traffic.ndjson` at the fixture root, and the
 * Mode A / Mode B step-filter primitive consumed by the harvest
 * driver.
 *
 * <p>Distinct from {@link NetworkResponseRecorder.flushMatching} which
 * writes ONE pattern-matched response file per `recordResponse` recipe
 * step. The Mode B manifest needs the COMPLETE set of intercepted
 * JSON responses observed during a real-bank flow so the per-bank
 * agent can curate a {@link ../Mirror/MirrorManifest.IMirrorManifest}
 * by hand (assigning phases, choosing fatal vs benign URLs, etc.).
 *
 * <p>One NDJSON row per captured response. Each row carries the
 * already-PII-redacted envelope produced by
 * {@link NetworkResponseRecorder.toCommittableJson}; no additional
 * redaction is layered here.
 *
 * <p>This module is a Mode B foundation primitive only — it does NOT
 * author the final `manifest.json`. The per-bank curation step
 * (Mode B test authoring) reads this NDJSON, classifies each row by
 * canonical phase, and emits the curated manifest committed to the
 * repo.
 *
 * @see ./NetworkResponseRecorder.ts
 * @see ../Mirror/MirrorManifest.ts
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import ScraperError from '../../../Scrapers/Base/ScraperError.js';
import type { ICapturedResponse, IResponseBufferHandle } from './NetworkResponseRecorder.js';
import { toCommittableJson } from './NetworkResponseRecorder.js';
import type { IExtendedRecipe } from './RecipeStepTypes.js';

const FIXTURE_FILE_MODE = 0o600;
const FIXTURE_DIR_MODE = 0o700;
const TRAFFIC_FILE_NAME = 'manifest-traffic.ndjson' as const;
const HARVEST_MODE_A_FLAG = '--mode-a-harvest' as const;
const HARVEST_MODE_B_FLAG = '--mode-b-harvest' as const;

/**
 * Harvest mode discriminant — mirrors the value parsed by
 * {@link ../Tools/HarvestBankHtml.parseHarvestMode}. Exported so
 * callers in `HarvestBankHtml.ts` can re-use the same type without
 * a back-import.
 */
type HarvestMode = 'a' | 'b';

/** Args bundle accepted by {@link writeManifestTraffic}. */
interface IWriteManifestTrafficArgs {
  readonly bankId: string;
  readonly fixtureRoot: string;
  readonly captured: readonly ICapturedResponse[];
}

/** Status reported back to the harvester host. */
interface IWriteManifestTrafficStatus {
  readonly bankId: string;
  readonly rows: number;
  readonly outPath: string;
}

/** Args bundle for {@link dumpManifestTrafficIfMode}. */
interface IDumpManifestTrafficArgs {
  readonly harvestMode: HarvestMode;
  readonly bankId: string;
  readonly fixtureRoot: string;
  readonly buffer: IResponseBufferHandle;
}

/**
 * Serialise a captured response to one NDJSON row (no trailing newline).
 *
 * <p>The PII-redacted envelope produced by `toCommittableJson` may not
 * be strictly valid JSON (e.g. numeric values like `"id":123456789`
 * become `"id":[redacted-id]` after `israeliId9` redaction). To keep
 * each NDJSON line strictly parseable, we wrap the redacted envelope
 * as an opaque JSON string under a single `envelope` key.
 *
 * @param entry - One captured response from the live buffer.
 * @returns Single-line JSON: `{"envelope": "<redacted-text>"}`.
 */
function rowFromCapture(entry: ICapturedResponse): string {
  const envelope = toCommittableJson(entry);
  return JSON.stringify({ envelope });
}

/**
 * Compose the NDJSON payload — one row per capture, `\n` separator,
 * trailing newline so POSIX tooling stays happy.
 *
 * @param captured - Snapshot of the live response buffer.
 * @returns NDJSON string ready to write.
 */
function composeNdjsonPayload(captured: readonly ICapturedResponse[]): string {
  if (captured.length === 0) return '';
  const rows = captured.map(rowFromCapture);
  return `${rows.join('\n')}\n`;
}

/**
 * Ensure the fixture root exists (owner-only mode) before writing.
 *
 * @param fixtureRoot - Per-bank fixture directory.
 * @returns Resolves once the directory is in place.
 */
async function ensureFixtureDir(fixtureRoot: string): Promise<void> {
  await fs.mkdir(fixtureRoot, { recursive: true, mode: FIXTURE_DIR_MODE });
}

/**
 * Write the NDJSON traffic dump to disk and report status.
 *
 * @param args - bankId + fixtureRoot + captured snapshot.
 * @returns Status with the row count + absolute path written.
 */
async function writeManifestTraffic(
  args: IWriteManifestTrafficArgs,
): Promise<IWriteManifestTrafficStatus> {
  await ensureFixtureDir(args.fixtureRoot);
  const outPath = path.join(args.fixtureRoot, TRAFFIC_FILE_NAME);
  const payload = composeNdjsonPayload(args.captured);
  await fs.writeFile(outPath, payload, { encoding: 'utf8', mode: FIXTURE_FILE_MODE });
  return { bankId: args.bankId, rows: args.captured.length, outPath };
}

/**
 * Filter recipe steps according to the harvest mode.
 *
 * <p>Mode `'a'` (HTML pass) drops every `recordResponse` step — those
 * write JSON response files which belong to the Mode B network pass.
 * Mode `'b'` (network pass) keeps every step so the live response
 * buffer ends up populated for the post-recipe NDJSON dump.
 *
 * @param recipe - Extended recipe to filter.
 * @param mode - Current harvest mode.
 * @returns Recipe with mode-appropriate steps.
 */
function filterStepsByMode(recipe: IExtendedRecipe, mode: HarvestMode): IExtendedRecipe {
  if (mode === 'b') return recipe;
  const steps = recipe.steps.filter(s => s.kind !== 'recordResponse');
  return { bankId: recipe.bankId, steps };
}

/**
 * Throw when both harvest-mode flags are supplied.
 * @returns Never returns; always throws.
 */
function rejectBothFlags(): never {
  throw new ScraperError(
    `${HARVEST_MODE_A_FLAG} and ${HARVEST_MODE_B_FLAG} are mutually exclusive`,
  );
}

/**
 * Throw when neither harvest-mode flag is supplied.
 * @returns Never returns; always throws.
 */
function rejectMissingFlag(): never {
  throw new ScraperError(
    `must specify exactly one of ${HARVEST_MODE_A_FLAG} or ${HARVEST_MODE_B_FLAG}`,
  );
}

/**
 * Parse the mutually-exclusive `--mode-a-harvest` / `--mode-b-harvest`
 * flag. Throws when neither/both are supplied.
 * @param args - Sliced `process.argv` (flags already included).
 * @returns The resolved harvest mode.
 */
function parseHarvestMode(args: readonly string[]): HarvestMode {
  const hasA = args.includes(HARVEST_MODE_A_FLAG);
  const hasB = args.includes(HARVEST_MODE_B_FLAG);
  if (hasA && hasB) return rejectBothFlags();
  if (!hasA && !hasB) return rejectMissingFlag();
  return hasA ? 'a' : 'b';
}

/**
 * Build the {@link IWriteManifestTrafficArgs} bundle from the dump
 * args + buffer snapshot.
 *
 * @param args - Mode + bankId + fixtureRoot + live buffer.
 * @returns Args bundle for {@link writeManifestTraffic}.
 */
function buildWriteArgs(args: IDumpManifestTrafficArgs): IWriteManifestTrafficArgs {
  return {
    bankId: args.bankId,
    fixtureRoot: args.fixtureRoot,
    captured: args.buffer.snapshot(),
  };
}

/**
 * Drain + dump the live response buffer when the harvest mode is `'b'`.
 * No-op for mode `'a'`. Extracted from the harvest driver so the
 * caller stays under the 10-line cap.
 *
 * @param args - Mode + bankId + fixtureRoot + live buffer.
 * @returns Resolves once the NDJSON is written (or skipped).
 */
async function dumpManifestTrafficIfMode(args: IDumpManifestTrafficArgs): Promise<true> {
  if (args.harvestMode !== 'b') return true;
  await args.buffer.drain();
  const writeArgs = buildWriteArgs(args);
  const status = await writeManifestTraffic(writeArgs);
  console.log(`  → wrote ${String(status.rows)} traffic rows to ${status.outPath}`);
  return true;
}

export type {
  HarvestMode,
  IDumpManifestTrafficArgs,
  IWriteManifestTrafficArgs,
  IWriteManifestTrafficStatus,
};
export {
  dumpManifestTrafficIfMode,
  filterStepsByMode,
  HARVEST_MODE_A_FLAG,
  HARVEST_MODE_B_FLAG,
  parseHarvestMode,
  TRAFFIC_FILE_NAME,
  writeManifestTraffic,
};
