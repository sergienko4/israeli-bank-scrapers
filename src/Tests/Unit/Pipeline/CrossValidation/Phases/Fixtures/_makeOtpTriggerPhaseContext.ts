/**
 * Phase H.T3c.5 — fixture-driven IPipelineContext builder for the
 * cross-bank OTP-TRIGGER per-phase factory.
 *
 * <p>OTP-TRIGGER POST contract (per
 * `OtpTriggerPhaseActions.ts:285-295`): reads
 * `diagnostics.otpTriggerTarget` (committed by PRE) and probes the
 * scope — when the target is present, runs `probeTriggerScope`; when
 * absent, stamps `triggerScopeValidated=false` and returns success.
 *
 * <p>FINAL contract (per
 * `OtpTriggerPhaseActions.ts:378-382`): builds an {@link IOtpTrigger}
 * snapshot from accumulated diagnostics and commits onto
 * `ctx.otpTrigger`. Always succeeds — FINAL is observability, never
 * fails loud per design.
 *
 * <p>The helper seeds `diagnostics.otpTriggerTarget` +
 * `otpPhoneHint` from fixture-supplied values so the POST+FINAL
 * chain runs against captured-shape inputs without requiring a real
 * DOM-scan in PRE.
 */

import type { Page } from 'playwright-core';

import { some } from '../../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IPipelineContext,
  IResolvedTarget,
} from '../../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import {
  makeMockBrowserState,
  makeMockContext,
  makeMockFullPage,
  makeMockMediator,
} from '../../../../Scrapers/Pipeline/MockPipelineFactories.js';

/** Result of {@link buildOtpTriggerPhaseContext} — POST+FINAL replay-ready. */
export interface IOtpTriggerPhaseTestSubject {
  readonly context: IPipelineContext;
}

/** Bundled arguments for {@link buildOtpTriggerPhaseContext}. */
export interface IOtpTriggerPhaseContextArgs {
  readonly phoneHint: string;
  readonly otpUrl: string;
}

/** PII-safe synthetic resolved target — selector + contextId only. */
const SYNTHETIC_TRIGGER_TARGET = {
  selector: '[data-test-id="otp-send"]',
  contextId: 'fixture-otp-trigger-ctx',
  kind: 'css',
  candidateValue: '[data-test-id="otp-send"]',
} as unknown as IResolvedTarget;

/**
 * Build an OTP-TRIGGER-stage test subject from a fixture. Seeds the
 * diagnostics bag with a synthetic `otpTriggerTarget` + the fixture's
 * `phoneHint` so {@link executeTriggerPost} + {@link executeTriggerFinal}
 * run against captured-shape inputs.
 *
 * @param args - Bundled arguments (phoneHint, otpUrl).
 * @returns Context ready for OTP-TRIGGER.POST + FINAL replay.
 */
export function buildOtpTriggerPhaseContext(
  args: IOtpTriggerPhaseContextArgs,
): IOtpTriggerPhaseTestSubject {
  const { phoneHint, otpUrl } = args;
  const page: Page = makeMockFullPage(otpUrl);
  const browserState = makeMockBrowserState(page);
  const browser = some(browserState);
  const baseMediator = makeMockMediator();
  const mediator = some(baseMediator);
  const base = makeMockContext({ browser, mediator });
  const seededDiagnostics: typeof base.diagnostics = {
    ...base.diagnostics,
    otpTriggerTarget: SYNTHETIC_TRIGGER_TARGET,
    otpPhoneHint: phoneHint,
    triggerClickedAt: 0,
    otpTriggerPreUrl: otpUrl,
  } as unknown as typeof base.diagnostics;
  return { context: { ...base, diagnostics: seededDiagnostics } };
}
