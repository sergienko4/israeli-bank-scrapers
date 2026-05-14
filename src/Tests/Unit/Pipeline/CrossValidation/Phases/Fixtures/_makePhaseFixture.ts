/**
 * Returns a PII-redacted captured network pool plus its assertion
 * metadata for one bank scenario, ready to drive any Phase H
 * per-phase or full-flow factory.
 *
 * <p>Each fixture file under `<bank>/<scenarioId>.json` carries a
 * `_fixture` metadata block (bank, scenario id, originating run id,
 * rationale, expected-assertion bundle) and an ordered `pool` of
 * captured network responses. The pool mirrors what production
 * `INetworkDiscovery` accumulates across pipeline phases up to the
 * point the factory exercises, so the factory can replay production
 * code paths without a real browser or real bank.
 *
 * <p>Fixtures originate from real local scrape traces under
 * `C:/tmp/runs/pipeline/<bank>/<runId>/network/` and are
 * PII-redacted (Hebrew text → `FAKE TEXT`, account numbers →
 * `FAKE-000000`) before being committed. Per
 * `testing-organization-guidlines.md` "Use builders/factories for
 * test data generation": single source of truth for fixture loading;
 * Phase H factories consume via {@link loadPhaseFixture}.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE_FILE_PATH = fileURLToPath(import.meta.url);
const FIXTURES_DIR = dirname(FIXTURE_FILE_PATH);

/** Banks covered by Phase H factories. */
export const PHASE_H_BANKS = [
  'hapoalim',
  'beinleumi',
  'discount',
  'amex',
  'isracard',
  'max',
  'visacal',
] as const;

/** Bank name supported by {@link loadPhaseFixture}. */
export type PhaseHBank = (typeof PHASE_H_BANKS)[number];

/**
 * Single observed network response in the captured pool. Mirrors the
 * production `IDiscoveredEndpoint` surface relevant to the picker:
 * URL, HTTP method, request body, response status, response body.
 * `responseBody` is left as `unknown` so 204 No-Content (`null`),
 * top-level array, and top-level object shapes all flow through
 * without prior narrowing — each phase factory narrows what it needs.
 */
export interface IPhaseHCapture {
  readonly url: string;
  readonly method: 'GET' | 'POST';
  readonly postData: string;
  readonly status: number;
  readonly responseBody: unknown;
}

/**
 * Bundled expected assertions for any phase factory. Each field is
 * optional so a single scenario can drive multiple per-phase factories
 * without requiring every assertion bundle. Missing fields are skipped
 * by the consuming factory.
 */
export interface IPhaseHExpected {
  readonly dashboardTxnUrl?: string;
  readonly dashboardTxnMethod?: 'GET' | 'POST';
  readonly dashboardFieldMapDate?: string;
  readonly dashboardFieldMapAmount?: string;
  readonly dashboardPickerTier?: string;
  readonly extractedTxnCount?: number;
}

/** Fixture metadata block embedded at `_fixture` in every JSON. */
export interface IPhaseHFixtureMeta {
  readonly bank: PhaseHBank;
  readonly scenarioId: string;
  readonly captureRunId: string;
  readonly rationale: string;
  readonly expected: IPhaseHExpected;
}

/** Full loaded fixture handed to a phase factory. */
export interface IPhaseHFixture {
  readonly meta: IPhaseHFixtureMeta;
  readonly pool: readonly IPhaseHCapture[];
}

/** Internal raw JSON shape — `_fixture` + `pool` at top level. */
interface IRawPhaseHFixture {
  readonly _fixture: IPhaseHFixtureMeta;
  readonly pool: readonly IPhaseHCapture[];
}

/**
 * Loads one bank's PII-redacted captured pool plus its assertion
 * metadata. Returns the parsed fixture for direct consumption by a
 * Phase H per-phase or full-flow factory test.
 *
 * @param bank - Bank name (must be in {@link PHASE_H_BANKS}).
 * @param scenarioId - Scenario identifier inside the bank's folder
 *   (e.g. `204-empty-window`, `last-good`).
 * @returns Parsed fixture with metadata and captured pool.
 */
export function loadPhaseFixture(bank: PhaseHBank, scenarioId: string): IPhaseHFixture {
  const filePath = join(FIXTURES_DIR, bank, `${scenarioId}.json`);
  const raw = readFileSync(filePath, 'utf8');
  const parsed: IRawPhaseHFixture = JSON.parse(raw) as IRawPhaseHFixture;
  return { meta: parsed._fixture, pool: parsed.pool };
}
