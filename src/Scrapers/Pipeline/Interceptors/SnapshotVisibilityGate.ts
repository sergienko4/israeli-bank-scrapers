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
import type { PhaseName } from '../Types/Phase.js';

/** Max time we'll wait for an anchor to be visible in the snapshot. */
const VISIBILITY_TIMEOUT_MS = 8000;

/** WK candidate discriminator — e.g. 'xpath', 'ariaLabel'. */
type CandidateKind = string;
/** WK candidate value — the selector text. */
type CandidateValue = string;

/** One WK candidate shape — shared across the Registry. */
interface IWkCandidate {
  readonly kind: CandidateKind;
  readonly value: CandidateValue;
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
function candidateToLocator(candidate: IWkCandidate): CandidateValue {
  if (candidate.kind === 'xpath') return `xpath=${candidate.value}`;
  if (candidate.kind === 'ariaLabel') return `[aria-label="${candidate.value}"]`;
  if (candidate.kind === 'placeholder') return `[placeholder="${candidate.value}"]`;
  if (candidate.kind === 'labelText') return `text="${candidate.value}"`;
  if (candidate.kind === 'exactText') return `text="${candidate.value}"`;
  if (candidate.kind === 'textContent')
    return `:text-is("${candidate.value}"), :text("${candidate.value}")`;
  if (candidate.kind === 'clickableText') return `:text("${candidate.value}")`;
  if (candidate.kind === 'regex') return `text=/${candidate.value}/`;
  return '';
}

/** Race outcome — true if at least one locator became visible. */
type VisibilityOutcome = boolean;

/**
 * Race a single candidate's visibility on the page.
 * @param page - Playwright Page.
 * @param candidate - WK candidate.
 * @returns Promise resolving to true when visible, false on timeout/error.
 */
async function raceOne(page: Page, candidate: IWkCandidate): Promise<VisibilityOutcome> {
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
 * Wait for the phase-specific anchor before allowing a snapshot write.
 * OTP phases bypass the gate (GATE_DISABLED) since their target markup is
 * often inside an iframe that hasn't hydrated yet at phase end.
 * @param page - Live Playwright Page about to be serialised.
 * @param phase - Phase whose anchors must be visible.
 * @returns True when any anchor became visible within the timeout.
 */
async function waitForPhaseAnchor(page: Page, phase: string): Promise<VisibilityOutcome> {
  if (GATE_DISABLED.has(phase)) return true;
  const anchors = PHASE_ANCHORS[phase as PhaseName];
  if (!anchors || anchors.length === 0) return true;
  /**
   * Bind page so Promise.allSettled receives a named thunk per candidate.
   * @param c - WK candidate.
   * @returns Visibility outcome promise.
   */
  const probe = (c: IWkCandidate): Promise<VisibilityOutcome> => raceOne(page, c);
  const promises = anchors.map(probe);
  const outcomes = await Promise.allSettled(promises);
  const hits = outcomes.filter((o): VisibilityOutcome => o.status === 'fulfilled' && o.value);
  return hits.length > 0;
}

export default waitForPhaseAnchor;
export { waitForPhaseAnchor };
