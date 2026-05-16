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

import ScraperError from '../../../../../../Scrapers/Base/ScraperError.js';

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
 *
 * <p>Phase H.T3c.4 (2026-05-16) — added LOGIN-stage assertion fields
 * so the cross-bank LOGIN factory can pin the sub-step contract
 * (PRE / ACTION / POST / FINAL) per bank without conflating with
 * DASHBOARD expectations. The `*Outcome` fields carry the discriminated
 * `Procedure` verdict that each sub-step returns; shape fields carry
 * the strongest cross-bank-meaningful signal each step exposes.
 */
export interface IPhaseHExpected {
  readonly dashboardTxnUrl?: string;
  readonly dashboardTxnMethod?: 'GET' | 'POST';
  readonly dashboardFieldMapDate?: string;
  readonly dashboardFieldMapAmount?: string;
  readonly dashboardPickerTier?: string;
  readonly extractedTxnCount?: number;
  /** PRE sub-step Procedure verdict — discovery must succeed for any
   *  ACTION attempt to be meaningful. */
  readonly loginPreOutcome?: 'success' | 'fail';
  /** ACTION sub-step Procedure verdict — fill-and-submit either
   *  succeeded sealing the action or returned a typed fail. */
  readonly loginActionOutcome?: 'success' | 'fail';
  /** POST sub-step Procedure verdict — auth-failure watcher + form
   *  scan + traffic wait + post callback + async checks together. */
  readonly loginPostOutcome?: 'success' | 'fail';
  /** FINAL sub-step Procedure verdict — cookie audit + API strategy
   *  signal committed to context. */
  readonly loginFinalOutcome?: 'success' | 'fail';
  /** PRE shape: did the field discovery find a password field on any
   *  active iframe? Pins the cross-bank password-field-required
   *  contract independent of selectors. */
  readonly loginPreFoundPassword?: boolean;
  /** ACTION shape: submit method used (`form-submit` / `enter-key` /
   *  `button-click`). Each bank historically uses one consistently;
   *  pinning the value catches submit-strategy drift. */
  readonly loginActionSubmitMethod?: 'form-submit' | 'enter-key' | 'button-click';
  /** POST shape: was post-login dashboard traffic observed? Tracks the
   *  WK auth-pattern match across banks without leaking URLs. */
  readonly loginPostHasTraffic?: boolean;
  /** FINAL shape: minimum session-cookie count expected after a
   *  successful login. Banks vary; lower-bound check guards against
   *  silent session-truncation regressions. */
  readonly loginFinalMinCookieCount?: number;
  /** HOME PRE: visible trigger text the WK_HOME.ENTRY race expects to
   *  surface on this bank's homepage (e.g. 'התחברות', 'כניסה').
   *  Documentation-only — not asserted dynamically here. */
  readonly homePreTriggerText?: string;
  /** HOME POST: did the URL change from homepageUrl after the ACTION
   *  click? Drives the cross-bank `executeValidateLoginArea` contract
   *  through the `didNavigate` branch. */
  readonly homePostDidNavigate?: boolean;
  /** HOME POST: were post-nav iframes present (Hapoalim-group banks
   *  host login in an iframe)? Drives the `hasFrames` branch. */
  readonly homePostHasFrames?: boolean;
  /** HOME POST: Procedure verdict — should the POST succeed under the
   *  bank's last-good shape? */
  readonly homePostOutcome?: 'success' | 'fail';
  /** PRE-LOGIN POST: was the password field visible after the reveal
   *  click on the bank's login page? Drives the form-gate contract. */
  readonly preLoginPostFormGateFound?: boolean;
  /** PRE-LOGIN POST: Procedure verdict — should the POST succeed under
   *  the bank's last-good shape? */
  readonly preLoginPostOutcome?: 'success' | 'fail';
  /** PRE-LOGIN FINAL: Procedure verdict — when POST succeeds POST
   *  sets `loginAreaReady=true` and FINAL signals to LOGIN. */
  readonly preLoginFinalOutcome?: 'success' | 'fail';
  /** OTP-TRIGGER PRE: redacted phone-hint string the bank surfaces
   *  (e.g. masked phone number tail). Pinned per-bank because the
   *  hint-format is bank-specific (4-digit tail, last-2, etc.). */
  readonly otpTriggerPhoneHint?: string;
  /** OTP-TRIGGER POST: did the scope-bound validation observe the
   *  trigger panel disappearing OR a 2xx ACK on the auth domain? */
  readonly otpTriggerPostScopeValidated?: boolean;
  /** OTP-TRIGGER FINAL: should `ctx.otpTrigger` be populated with
   *  `triggered=true` after the FINAL commit? */
  readonly otpTriggerFinalTriggered?: boolean;
  /** OTP-TRIGGER FINAL: Procedure verdict — FINAL never fails loud
   *  per design, so this is always `'success'` for last-good. */
  readonly otpTriggerFinalOutcome?: 'success' | 'fail';
  /** OTP-FILL POST: Procedure verdict — succeeds when the bank's
   *  OTP form is gone AND no error banner is visible after submit. */
  readonly otpFillPostOutcome?: 'success' | 'fail';
  /** OTP-FILL FINAL: Procedure verdict — always succeed per design
   *  (observability-only). */
  readonly otpFillFinalOutcome?: 'success' | 'fail';
  /** ACCOUNT-RESOLVE POST: Procedure verdict — succeeds when the
   *  captured pre-nav pool yields >= 1 id and the count matches the
   *  expected container max. */
  readonly accountResolvePostOutcome?: 'success' | 'fail';
  /** ACCOUNT-RESOLVE POST: expected id count from the captured
   *  pre-nav pool's account-containing endpoint. */
  readonly accountResolveExpectedIdCount?: number;
  /** ACCOUNT-RESOLVE FINAL: Procedure verdict — always succeed per
   *  design (telemetry-only). */
  readonly accountResolveFinalOutcome?: 'success' | 'fail';
  /** SCRAPE POST: Procedure verdict — succeeds when ctx.scrape.accounts
   *  has >= 1 account AND at least one account has >= 1 txn. */
  readonly scrapePostOutcome?: 'success' | 'fail';
  /** SCRAPE FINAL: Procedure verdict — always succeed per design. */
  readonly scrapeFinalOutcome?: 'success' | 'fail';
  /** SCRAPE: expected txn count for the bank's last-good fixture. */
  readonly scrapeExpectedTxnCount?: number;
  /** INIT POST: Procedure verdict — succeeds when page.url() is
   *  not 'about:blank' and not the Firefox neterror page. */
  readonly initPostOutcome?: 'success' | 'fail';
  /** INIT POST: post-goto URL captured at INIT.POST time. */
  readonly initPostUrl?: string;
  /** TERMINATE: Procedure verdict — TERMINATE runs the cleanup
   *  fns committed by INIT.PRE and always succeeds even when one
   *  cleanup throws (errors swallowed per design). */
  readonly terminateOutcome?: 'success' | 'fail';
  /** AUTH-DISCOVERY POST: Procedure verdict — succeeds when the
   *  captured cookie jar carries >= 1 session cookie at AUTH-
   *  DISCOVERY entry. Mirrors the LOGIN.FINAL contract but lives on
   *  the AUTH-DISCOVERY fixture so the schema names match the phase
   *  the assertion verifies (CodeRabbit 2026-05-16 finding #7). */
  readonly authDiscoveryPostOutcome?: 'success' | 'fail';
  /** AUTH-DISCOVERY POST: minimum session-cookie count expected at
   *  AUTH-DISCOVERY entry. */
  readonly authDiscoveryPostMinCookieCount?: number;
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
 * Reports whether the parsed JSON has the expected `_fixture` + `pool`
 * shape. Returns a boolean instead of throwing so the caller decides
 * how to fail loud with a fixture-path-tagged message.
 *
 * @param parsed - Raw `JSON.parse` result.
 * @returns True when both fields are present and `pool` is an array.
 */
function hasFixtureShape(parsed: unknown): parsed is IRawPhaseHFixture {
  if (parsed === null || typeof parsed !== 'object') return false;
  const candidate = parsed as { _fixture?: unknown; pool?: unknown };
  // CodeRabbit 2026-05-15: require `_fixture` to be a plain object —
  // the previous `!== undefined` check accepted primitives like
  // `_fixture: 1` / `_fixture: 'x'` which would pass shape validation
  // but explode in consumer code with cryptic stack traces.
  const fixture = candidate._fixture;
  const isFixtureObject = fixture !== null && typeof fixture === 'object';
  return isFixtureObject && Array.isArray(candidate.pool);
}

/**
 * Loads one bank's PII-redacted captured pool plus its assertion
 * metadata. Returns the parsed fixture for direct consumption by a
 * Phase H per-phase or full-flow factory test.
 *
 * <p>Fail-fast shape guard (CodeRabbit review 2026-05-15): throws a
 * fixture-path-tagged error when the parsed JSON lacks the expected
 * `_fixture` block or `pool` array. Catches malformed-fixture bugs
 * at load time rather than letting `undefined` propagate to deep
 * consumer code where the resulting error is cryptic.
 *
 * @param bank - Bank name (must be in {@link PHASE_H_BANKS}).
 * @param scenarioId - Scenario identifier inside the bank's folder
 *   (e.g. `204-empty-window`, `last-good`).
 * @returns Parsed fixture with metadata and captured pool.
 * @throws {Error} When the fixture JSON does not match
 *   {@link IRawPhaseHFixture}.
 */
export function loadPhaseFixture(bank: PhaseHBank, scenarioId: string): IPhaseHFixture {
  const filePath = join(FIXTURES_DIR, bank, `${scenarioId}.json`);
  const raw = readFileSync(filePath, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (!hasFixtureShape(parsed)) {
    throw new ScraperError(
      `PHASE_H_FIXTURE_MALFORMED: ${filePath} — expected '_fixture' object and 'pool' array`,
    );
  }
  return { meta: parsed._fixture, pool: parsed.pool };
}
