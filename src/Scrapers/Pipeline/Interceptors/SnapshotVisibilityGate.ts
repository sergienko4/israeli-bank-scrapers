/**
 * Snapshot visibility gate — before we save page.content() for a phase,
 * wait until an element that the NEXT phase's PRE will probe for is
 * actually visible. This guarantees mock↔live parity: if the resolver
 * can't find a visible target during capture, it never will in replay.
 *
 * The mapping reuses the SAME WK constants the mediator uses at runtime,
 * so the recorder and the PRE resolver share one contract (Rule #20).
 */

import type { Page } from 'playwright-core';

import { WK_DASHBOARD } from '../Registry/WK/DashboardWK.js';
import { WK_HOME } from '../Registry/WK/HomeWK.js';
import { WK_LOGIN_FORM } from '../Registry/WK/LoginWK.js';
import { WK_OTP_INPUT } from '../Registry/WK/OtpFillWK.js';
import { WK_OTP_TRIGGER } from '../Registry/WK/OtpTriggerWK.js';
import type { Brand } from '../Types/Brand.js';
import type { PhaseName } from '../Types/Phase.js';

type LocatorExpr = Brand<string, 'LocatorExpr'>;
type IsHitFulfilled = Brand<boolean, 'IsHitFulfilled'>;

/** Max time we'll wait for an anchor to be visible in the snapshot. */
const VISIBILITY_TIMEOUT_MS = 8000;

/** One WK candidate shape — shared across the Registry. */
interface IWkCandidate {
  readonly kind: string;
  readonly value: string;
}

/**
 * Phase → anchor-WK candidates. Mirrors what each phase's PRE probes for.
 * If any candidate becomes visible during capture, the snapshot is
 * guaranteed to contain a valid PRE target.
 * @returns Partial map keyed by PhaseName.
 */
function buildPhaseAnchors(): Partial<Record<PhaseName, readonly IWkCandidate[]>> {
  return {
    home: WK_HOME.ENTRY,
    'pre-login': WK_LOGIN_FORM.password,
    login: WK_LOGIN_FORM.password,
    'otp-trigger': WK_OTP_TRIGGER,
    'otp-fill': WK_OTP_INPUT,
    dashboard: WK_DASHBOARD.REVEAL,
    scrape: WK_DASHBOARD.REVEAL,
  };
}

/** Resolved map singleton. */
const PHASE_ANCHORS = buildPhaseAnchors();

/**
 * Translate a WK candidate to a Playwright locator expression.
 * @param candidate - WK candidate object.
 * @returns Selector string suitable for page.locator().
 */
function candidateToLocator(candidate: IWkCandidate): LocatorExpr {
  if (candidate.kind === 'xpath') return `xpath=${candidate.value}` as LocatorExpr;
  if (candidate.kind === 'ariaLabel') return `[aria-label="${candidate.value}"]` as LocatorExpr;
  if (candidate.kind === 'placeholder') return `[placeholder="${candidate.value}"]` as LocatorExpr;
  if (candidate.kind === 'labelText') return `text="${candidate.value}"` as LocatorExpr;
  if (candidate.kind === 'exactText') return `text="${candidate.value}"` as LocatorExpr;
  if (candidate.kind === 'textContent')
    return `:text-is("${candidate.value}"), :text("${candidate.value}")` as LocatorExpr;
  if (candidate.kind === 'clickableText') return `:text("${candidate.value}")` as LocatorExpr;
  if (candidate.kind === 'regex') return `text=/${candidate.value}/` as LocatorExpr;
  return '' as LocatorExpr;
}

/**
 * Race a single candidate's visibility on the page.
 * @param page - Playwright Page.
 * @param candidate - WK candidate.
 * @returns Promise resolving to true when visible, false on timeout/error.
 */
async function raceOne(page: Page, candidate: IWkCandidate): Promise<boolean> {
  const selector = candidateToLocator(candidate);
  if (!selector) return false;
  try {
    await page
      .locator(selector)
      .first()
      .waitFor({ state: 'visible', timeout: VISIBILITY_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for any phase-anchor candidate to be visible before snapshotting.
 * Rule #20 contract: recorder waits for what PRE will look for — guarantees
 * that a successful live probe corresponds to a successful mock probe.
 * @param page - Playwright Page about to be captured.
 * @param phase - Phase the snapshot is being saved under.
 * @returns True if any anchor became visible, false if all timed out.
 */
/** Phases where the gate is disabled — captures always write regardless. */
const GATE_DISABLED: ReadonlySet<string> = new Set(['otp-trigger', 'otp-fill']);

/**
 * Did this allSettled outcome resolve to a visible hit?
 * @param o - One Promise.allSettled outcome.
 * @returns Branded predicate.
 */
function isVisibleHit(o: PromiseSettledResult<boolean>): IsHitFulfilled {
  return (o.status === 'fulfilled' && o.value) as IsHitFulfilled;
}

/**
 * Build a candidate-to-promise probe bound to a specific page.
 * @param page - Live Playwright Page.
 * @returns Probe function.
 */
function makeProbe(page: Page): (c: IWkCandidate) => Promise<boolean> {
  return (c: IWkCandidate): Promise<boolean> => raceOne(page, c);
}

/**
 * Race every candidate visibility check and report whether any succeeded.
 * @param page - Live Playwright Page.
 * @param anchors - WK candidates to probe in parallel.
 * @returns True when at least one candidate became visible.
 */
async function raceAnyAnchor(page: Page, anchors: readonly IWkCandidate[]): Promise<boolean> {
  const probe = makeProbe(page);
  const probes = anchors.map(probe);
  const outcomes = await Promise.allSettled(probes);
  return outcomes.some(isVisibleHit);
}

/**
 * Wait for the phase-specific anchor before allowing a snapshot write.
 * OTP phases bypass the gate (GATE_DISABLED) since their target markup is
 * often inside an iframe that hasn't hydrated yet at phase end.
 * @param page - Live Playwright Page about to be serialised.
 * @param phase - Phase whose anchors must be visible.
 * @returns True when any anchor became visible within the timeout.
 */
async function waitForPhaseAnchor(page: Page, phase: string): Promise<boolean> {
  if (GATE_DISABLED.has(phase)) return true;
  const anchors = PHASE_ANCHORS[phase as PhaseName];
  if (!anchors || anchors.length === 0) return true;
  return raceAnyAnchor(page, anchors);
}

export default waitForPhaseAnchor;
export { waitForPhaseAnchor };
