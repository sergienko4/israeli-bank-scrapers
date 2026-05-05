/**
 * MOCK_MODE phase policy — single source of truth for which stages of which
 * phase should short-circuit when running against local HTML snapshots.
 *
 * This lives OUTSIDE individual phase files on purpose (OCP — Rule #14):
 * phases describe real-world behavior, they shouldn't know MOCK_MODE exists.
 * BasePhase.run() consults this map at template-method time.
 *
 * Semantics: `true` means "skip this stage in MOCK_MODE and return succeed".
 * A phase absent from the map runs all 4 stages normally (INIT, TERMINATE).
 */

import type { PhaseName } from './Phase.js';

/** Whether a BasePhase stage should short-circuit in MOCK_MODE. */
type ShouldSkipStage = boolean;

/** Which of the 4 BasePhase stages to short-circuit when MOCK_MODE is active. */
export interface IMockStagePolicy {
  readonly pre: ShouldSkipStage;
  readonly action: ShouldSkipStage;
  readonly post: ShouldSkipStage;
  readonly final: ShouldSkipStage;
}

/**
 * Rule #20 — PRE validates selectors against the local snapshot.
 * ACTION is the "executioner" (clicks, fills, SMS) — skipped under MOCK.
 * POST/FINAL depend on live network/navigation signals — also skipped.
 *
 * HOME.pre's hit-test-fails issue on marketing pages is handled by the
 * MOCK_MODE attached-fallback in resolveVisible (elements in DOM but
 * hidden still match). Beinleumi's iframe-scoped OTP input is served
 * via per-frame snapshots captured by SnapshotFrameCapture.
 */
const RUN_PRE_ONLY: IMockStagePolicy = { pre: false, action: true, post: true, final: true };

/**
 * Every non-INIT/TERMINATE phase validates PRE against the local snapshot.
 * A PRE failure means the selector doesn't match the rendered DOM — a
 * real regression the gate MUST catch.
 */
export const MOCK_POLICY_BY_PHASE: Partial<Record<PhaseName, IMockStagePolicy>> = {
  home: RUN_PRE_ONLY,
  'pre-login': RUN_PRE_ONLY,
  login: RUN_PRE_ONLY,
  'otp-trigger': RUN_PRE_ONLY,
  'otp-fill': RUN_PRE_ONLY,
  'api-direct-call': RUN_PRE_ONLY,
  dashboard: RUN_PRE_ONLY,
  scrape: RUN_PRE_ONLY,
};

/** Default when a phase has no entry — run everything. */
const RUN_ALL: IMockStagePolicy = { pre: false, action: false, post: false, final: false };

/**
 * Look up the mock-stage policy for a phase. Missing entries default to
 * RUN_ALL so INIT/TERMINATE don't need to opt in.
 * @param phase - Phase name.
 * @returns Policy declaring which stages to short-circuit.
 */
export function mockPolicyFor(phase: PhaseName): IMockStagePolicy {
  return MOCK_POLICY_BY_PHASE[phase] ?? RUN_ALL;
}
