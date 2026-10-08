/**
 * Shared reader for the cross-bank scrape fixture families.
 *
 * <p>Every family under this directory stores one JSON envelope per bank:
 * a `_fixture` metadata block plus a `captures` array of capture-shaped
 * network responses (recorded or synthetic). Each family owns its
 * metadata shape and file layout; this module owns only the envelope
 * read and the empty-captures guard, so no family depends on a sibling
 * family.
 */

import * as fs from 'node:fs';

import ScraperError from '../../../../../../Scrapers/Base/ScraperError.js';

/** One capture entry inside a fixture's `captures` array. */
export interface IFixtureCapture {
  readonly url: string;
  readonly method: 'POST' | 'GET';
  readonly captureIndex: number;
  readonly postData?: string;
  readonly responseBody: Record<string, unknown>;
}

/** On-disk fixture envelope: a `_fixture` metadata block plus captures. */
interface IRawFixture<TMeta> {
  readonly _fixture: TMeta;
  readonly captures: readonly IFixtureCapture[];
}

/** A loaded fixture: its metadata block and its first capture entry. */
export interface ILoadedFixture<TMeta> {
  readonly meta: TMeta;
  readonly capture: IFixtureCapture;
}

/**
 * Parse one fixture file from disk into its raw envelope shape.
 *
 * @param filePath - Absolute path of the fixture JSON file.
 * @returns The parsed envelope, typed by the caller's metadata shape.
 */
function parseFixtureFile<TMeta>(filePath: string): IRawFixture<TMeta> {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw) as IRawFixture<TMeta>;
}

/**
 * Read a fixture envelope and return its metadata with the first capture.
 *
 * <p>Fail-fast capture guard (CodeRabbit review 2026-05-15): the
 * fixture envelope ships an array of captures and downstream
 * consumers expect a non-optional first entry. An empty array would
 * silently surface as `undefined` deep inside the auto-mapper. Throw
 * a fixture-path-tagged error here so the failure mode is obvious.
 *
 * @param filePath - Absolute path of the fixture JSON file.
 * @param errorTag - Error-code prefix naming the calling fixture family.
 * @returns Parsed fixture with metadata + first capture entry.
 * @throws {ScraperError} When the fixture's `captures` array is empty.
 */
export function readFixtureEnvelope<TMeta>(
  filePath: string,
  errorTag: string,
): ILoadedFixture<TMeta> {
  const parsed = parseFixtureFile<TMeta>(filePath);
  if (parsed.captures.length === 0) {
    throw new ScraperError(`${errorTag}: ${filePath} — captures[] must be non-empty`);
  }
  return { meta: parsed._fixture, capture: parsed.captures[0] };
}
