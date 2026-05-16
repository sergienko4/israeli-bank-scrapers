/**
 * Phase H.T3c.4 — fixture-driven IPipelineContext builder for the
 * cross-bank LOGIN per-phase factory. Returns a context whose
 * mediator returns the fixture's redacted cookie snapshot, so the
 * LOGIN.POST + LOGIN.FINAL action handlers can run end-to-end
 * against captured production shape (not synthetic mocks).
 *
 * <p>Complements the M2.T10 LoginFactoryTest factory: M2.T10 covers
 * the LOGIN-config shape contract + isolated action-handler logic
 * with bank-agnostic synthetic mocks; H.T3c.4 covers the per-bank
 * captured-shape integration with a real production mediator surface.
 * Both layers are kept per testing-organization-guidlines.md
 * "integration tests over unit tests, unit tests for edge cases only".
 *
 * <p>This helper deliberately does NOT mock DOM-discovery surfaces
 * (PRE/ACTION) — those flows are heavily DOM-driven and the captured
 * runs under `C:/tmp/runs/pipeline/` carry only `network/` (no HTML
 * snapshots). The PRE/ACTION assertions in {@link IPhaseHExpected}
 * (`loginPreOutcome`, `loginActionSubmitMethod`, etc.) document the
 * cross-bank contract for fixture-rationale purposes; their dynamic
 * verification lives in M2.T10's synthetic factory.
 *
 * <p>Per `mocking-test-guidlines.md` "Mock external dependencies only"
 * + "Prefer lightweight fakes/stubs" — only mediator surfaces the
 * LOGIN.POST + LOGIN.FINAL actions touch are stubbed; everything else
 * is the production type.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from 'playwright-core';

import ScraperError from '../../../../../../Scrapers/Base/ScraperError.js';
import type { ICookieSnapshot } from '../../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { some } from '../../../../../../Scrapers/Pipeline/Types/Option.js';
import type { IPipelineContext } from '../../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import {
  makeContextWithLogin,
  makeMockFullPage,
  makeMockMediator,
} from '../../../../Scrapers/Pipeline/MockPipelineFactories.js';
import type { IPhaseHFixture, PhaseHBank } from './_makePhaseFixture.js';

const HELPER_FILE_PATH = fileURLToPath(import.meta.url);
const FIXTURES_DIR = dirname(HELPER_FILE_PATH);

/**
 * LOGIN-stage fixture extras carried by every per-bank
 * `login/<scenario>.json` under {@link IPhaseHFixture}.
 *
 * <p>The base {@link IPhaseHFixture} pool models post-submit network
 * traffic (each entry mirrors what `INetworkDiscovery` accumulates
 * during LOGIN.ACTION + LOGIN.POST). This sidecar carries the
 * LOGIN.FINAL cookie snapshot from the same captured run.
 *
 * <p>Cookie values are PII-redacted at fixture-author time: cookie
 * `name` is preserved (cross-bank session-cookie-name shape is part
 * of the contract); `domain` is replaced with a `.example` reserved
 * TLD; `value` is replaced with `FAKE_VALUE`.
 */
export interface ILoginFixtureCookies {
  readonly cookies: readonly ICookieSnapshot[];
}

/** Internal raw cookie entry as authored in the fixture JSON. */
interface IRawCookieEntry {
  readonly name: string;
  readonly domain: string;
  readonly value: string;
}

/**
 * Reports whether `value` carries the full {@link IRawCookieEntry}
 * shape (object with non-empty `name`, `domain`, `value` strings).
 * Catches malformed-fixture entries (primitives, missing fields)
 * at load time rather than letting them propagate as silent test
 * misses (CodeRabbit 2026-05-16 finding #2).
 *
 * @param value - Single array element from a fixture's cookies array.
 * @returns True iff value matches the cookie-entry contract.
 */
function isRawCookieEntry(value: unknown): value is IRawCookieEntry {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as { name?: unknown; domain?: unknown; value?: unknown };
  if (typeof candidate.name !== 'string') return false;
  if (typeof candidate.domain !== 'string') return false;
  return typeof candidate.value === 'string';
}

/**
 * Reports whether the parsed JSON exposes a `cookies` array of
 * {@link IRawCookieEntry} records. Validates every element shape
 * so malformed entries are rejected up-front with an actionable
 * load-time error rather than a cryptic downstream crash.
 *
 * @param parsed - Raw `JSON.parse` result.
 * @returns True when the cookies array is present and well-shaped.
 */
function hasCookieSidecar(
  parsed: unknown,
): parsed is { readonly cookies: readonly IRawCookieEntry[] } {
  if (parsed === null || typeof parsed !== 'object') return false;
  const candidate = parsed as { cookies?: unknown };
  if (!Array.isArray(candidate.cookies)) return false;
  return candidate.cookies.every(isRawCookieEntry);
}

/**
 * Map one raw fixture cookie entry into the production
 * {@link ICookieSnapshot} shape. Single-purpose so the load helper
 * stays declarative.
 *
 * @param entry - Raw cookie row from the fixture JSON.
 * @returns Production snapshot.
 */
function toCookieSnapshot(entry: IRawCookieEntry): ICookieSnapshot {
  return { name: entry.name, domain: entry.domain, value: entry.value };
}

/**
 * Internal — load the cookie sidecar from any `<bank>/<phase>/<scenario>.json`
 * fixture path. Fail-fast shape guard (matches {@link loadPhaseFixture}'s
 * discipline): throws a fixture-path-tagged error when the parsed JSON
 * lacks the expected `cookies` array.
 *
 * @param bank - Bank name from {@link PhaseHBank}.
 * @param phase - Phase folder name (`login`, `auth-discovery`, etc.).
 * @param scenarioId - Scenario identifier inside `<bank>/<phase>/`.
 * @returns Redacted cookie snapshot from the fixture.
 * @throws {ScraperError} When the fixture JSON lacks `cookies`.
 */
function loadCookieSidecar(
  bank: PhaseHBank,
  phase: 'login' | 'auth-discovery',
  scenarioId: string,
): readonly ICookieSnapshot[] {
  const filePath = join(FIXTURES_DIR, bank, phase, `${scenarioId}.json`);
  const parsed = parseFixtureJson(filePath);
  if (!hasCookieSidecar(parsed)) {
    throw new ScraperError(
      `PHASE_H_FIXTURE_COOKIES_MALFORMED: ${filePath} — expected top-level 'cookies' array`,
    );
  }
  return parsed.cookies.map(toCookieSnapshot);
}

/**
 * Read + parse a fixture file, wrapping any `SyntaxError` from
 * `JSON.parse` with a fixture-path-tagged {@link ScraperError} so
 * malformed-JSON failures surface with actionable diagnostics
 * (CodeRabbit 2026-05-16 finding #22).
 *
 * @param filePath - Absolute path to the fixture JSON.
 * @returns Parsed JSON value (still untyped — caller validates shape).
 * @throws {ScraperError} When the file cannot be parsed as JSON.
 */
function parseFixtureJson(filePath: string): unknown {
  const raw = readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (parseError) {
    const detail = parseError instanceof Error ? parseError.message : 'unknown';
    throw new ScraperError(`PHASE_H_FIXTURE_JSON_INVALID: ${filePath} — ${detail}`);
  }
}

/**
 * Load the LOGIN-stage cookie sidecar for a bank scenario.
 *
 * @param bank - Bank name from {@link PhaseHBank}.
 * @param scenarioId - Scenario identifier inside `<bank>/login/`.
 * @returns Redacted cookie snapshot from the fixture.
 * @throws {ScraperError} When the fixture JSON lacks `cookies`.
 */
export function loadLoginFixtureCookies(
  bank: PhaseHBank,
  scenarioId: string,
): readonly ICookieSnapshot[] {
  return loadCookieSidecar(bank, 'login', scenarioId);
}

/**
 * Load the AUTH-DISCOVERY-stage cookie sidecar for a bank scenario.
 *
 * <p>At AUTH-DISCOVERY POST entry the cookie jar is structurally
 * identical to LOGIN.FINAL exit (no inter-phase mutation), but the
 * fixture file lives under `<bank>/auth-discovery/` per locked plan
 * H.T3c.7 (7 AUTH-DISC fixtures requirement).
 *
 * @param bank - Bank name from {@link PhaseHBank}.
 * @param scenarioId - Scenario identifier inside `<bank>/auth-discovery/`.
 * @returns Redacted cookie snapshot from the fixture.
 * @throws {ScraperError} When the fixture JSON lacks `cookies`.
 */
export function loadAuthDiscoveryFixtureCookies(
  bank: PhaseHBank,
  scenarioId: string,
): readonly ICookieSnapshot[] {
  return loadCookieSidecar(bank, 'auth-discovery', scenarioId);
}

/**
 * Build a LOGIN-stage `IPipelineContext` from a fixture + redacted
 * cookie snapshot. The returned context has `browser` + `login` + the
 * supplied `mediator` populated so `executeValidateLogin` (POST) and
 * `executeLoginSignal` (FINAL) can run.
 *
 * <p>The mediator's `getCookies` returns the fixture-redacted cookie
 * array; everything else falls through to {@link makeMockMediator}'s
 * production-safe defaults (no errors, no auth-failure watcher fire,
 * empty traffic).
 *
 * @param fixture - Loaded phase-H fixture (carries scenario metadata).
 * @param cookies - Redacted cookie snapshot for LOGIN.FINAL.
 * @returns Context ready for LOGIN.POST + LOGIN.FINAL replay.
 */
export function buildLoginPhaseContext(
  fixture: IPhaseHFixture,
  cookies: readonly ICookieSnapshot[],
): IPipelineContext {
  const page: Page = makeMockFullPage(`https://${fixture.meta.bank}.example.com/login`);
  const baseContext = makeContextWithLogin(page);
  const cookieMediator = makeMockMediator({
    /**
     * Return the fixture's redacted cookie snapshot so
     * `executeLoginSignal`'s session-cookie audit drives off
     * production shape instead of an empty stub.
     * @returns Fixture cookies.
     */
    getCookies: (): Promise<readonly ICookieSnapshot[]> => Promise.resolve(cookies),
  });
  return { ...baseContext, mediator: some(cookieMediator) };
}
