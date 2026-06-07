/**
 * HAR 1.2 loader — reads a Playwright `recordHar` output file and
 * validates it into a strongly-typed {@link IHarFile}.
 *
 * Why strict validation up front:
 * - Downstream {@link StatefulRewriter} and {@link HarToMirrorManifest}
 *   expect well-formed entries; failing fast at load time produces a
 *   single clear error rather than a cascade of `cannot read property`
 *   crashes later in the request stream.
 * - The repo bans `@typescript-eslint/no-unsafe-assignment` and
 *   `no-explicit-any`, so JSON.parse output is narrowed via assertion
 *   functions before any property access.
 *
 * Public surface (factory):
 * - {@link loadHarFile} — full HAR document.
 * - {@link loadHarEntries} — convenience: just the entry array.
 *
 * @see ./HarTypes.ts — shape definitions.
 */

import { readFileSync } from 'node:fs';

import ScraperError from '../../../Scrapers/Base/ScraperError.js';
import type { IHarEntry, IHarFile } from './HarTypes.js';

/**
 * Read a file and parse it as JSON, returning `unknown`.
 *
 * Intentionally returns `unknown` (not `any`) so downstream assertion
 * functions are forced to narrow before property access.
 *
 * @param filePath - Absolute path to the HAR file.
 * @returns Parsed JSON value (caller must validate shape).
 */
function readJsonFile(filePath: string): unknown {
  const raw = readFileSync(filePath, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  return parsed;
}

/**
 * Narrow `value` to a plain object (record). Throws on null/primitive.
 *
 * @param value - Candidate value.
 * @param ctx - Context label used in the error message.
 */
function assertObject(value: unknown, ctx: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ScraperError(`HAR validation: ${ctx} is not an object`);
  }
}

/**
 * Narrow `value` to a readonly array.
 *
 * @param value - Candidate value.
 * @param ctx - Context label used in the error message.
 */
function assertArray(value: unknown, ctx: string): asserts value is readonly unknown[] {
  if (!Array.isArray(value)) throw new ScraperError(`HAR validation: ${ctx} is not an array`);
}

/**
 * Validate one HAR entry has the request/response sub-objects the
 * simulator depends on.
 *
 * Only the OUTER shape is checked here — request.method/url and
 * response.status/content are validated lazily by {@link StatefulRewriter}
 * when an entry is actually picked for replay.
 *
 * @param entry - Candidate entry object.
 * @param index - Position in entries[] (for error messages).
 */
function assertEntryShape(entry: unknown, index: number): asserts entry is IHarEntry {
  assertObject(entry, `entries[${String(index)}]`);
  assertObject(entry.request, `entries[${String(index)}].request`);
  assertObject(entry.response, `entries[${String(index)}].response`);
}

/**
 * Validate the top-level HAR document has `log.entries[]`.
 *
 * @param data - Raw parsed JSON.
 */
function assertHarFile(data: unknown): asserts data is IHarFile {
  assertObject(data, 'root');
  assertObject(data.log, 'log');
  assertArray(data.log.entries, 'log.entries');
  data.log.entries.forEach((entry, index) => {
    assertEntryShape(entry, index);
  });
}

/**
 * Load and validate a HAR file at `filePath`.
 *
 * @param filePath - Absolute path to a Playwright-recorded HAR JSON.
 * @returns Typed HAR file.
 */
function loadHarFile(filePath: string): IHarFile {
  const data = readJsonFile(filePath);
  assertHarFile(data);
  return data;
}

/**
 * Convenience: load a HAR file and return just the entry array.
 *
 * @param filePath - Absolute path to a Playwright-recorded HAR JSON.
 * @returns Frozen entries array.
 */
function loadHarEntries(filePath: string): readonly IHarEntry[] {
  const file = loadHarFile(filePath);
  return file.log.entries;
}

export { loadHarEntries, loadHarFile };
