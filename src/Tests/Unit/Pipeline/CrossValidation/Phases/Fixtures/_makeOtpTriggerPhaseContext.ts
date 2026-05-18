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
 *
 * <p>Per `coding-principle-guidlines.md` "Maximum 10 lines per
 * method" the public builder delegates to two single-purpose
 * helpers (`assembleOtpTriggerBase`, `seedOtpTriggerDiagnostics`).
 */

import type { Page } from 'playwright-core';

import { mintContextId } from '../../../../../../Scrapers/Pipeline/Types/Brand.js';
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

/** PII-safe synthetic resolved target — properly typed via mint helper, no inline cast. */
const SYNTHETIC_TRIGGER_TARGET: IResolvedTarget = {
  selector: '[data-test-id="otp-send"]',
  contextId: mintContextId('fixture-otp-trigger-ctx'),
  kind: 'css',
  candidateValue: '[data-test-id="otp-send"]',
};

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
  const base = assembleOtpTriggerBase(args.otpUrl);
  const diagnostics = seedOtpTriggerDiagnostics(base, args);
  return { context: { ...base, diagnostics } };
}

/**
 * Build the base pipeline context (browser + mediator + defaults)
 * for OTP-TRIGGER replay. Single-purpose so the public builder
 * stays under the 10-line method ceiling.
 *
 * @param otpUrl - URL the mock page reports.
 * @returns Pipeline context with mock browser + mediator wired in.
 */
function assembleOtpTriggerBase(otpUrl: string): IPipelineContext {
  const page: Page = makeMockFullPage(otpUrl);
  const browserState = makeMockBrowserState(page);
  const browser = some(browserState);
  const baseMediator = makeMockMediator();
  const mediator = some(baseMediator);
  return makeMockContext({ browser, mediator });
}

/** Diagnostics shape after OTP-TRIGGER.PRE has committed its keys. */
interface IOtpTriggerSeededDiagnostics {
  readonly otpTriggerTarget: IResolvedTarget;
  readonly otpPhoneHint: string;
  readonly triggerClickedAt: number;
  readonly otpTriggerPreUrl: string;
}

/**
 * Seed the diagnostics bag with the OTP-TRIGGER.PRE outputs
 * (target + phoneHint + click epoch + entry URL) so POST+FINAL
 * read fixture-driven values.
 *
 * @param base - Base context to extend.
 * @param args - Fixture-driven phoneHint + otpUrl.
 * @returns Diagnostics record with PRE keys stamped.
 */
function seedOtpTriggerDiagnostics(
  base: IPipelineContext,
  args: IOtpTriggerPhaseContextArgs,
): IPipelineContext['diagnostics'] {
  return { ...base.diagnostics, ...buildSeededDiagnostics(args) };
}

/**
 * Build the PRE-stage diagnostic stamps applied by
 * {@link seedOtpTriggerDiagnostics}.
 *
 * @param args - Fixture-driven phoneHint + otpUrl.
 * @returns Diagnostic keys committed by OTP-TRIGGER.PRE.
 */
function buildSeededDiagnostics(args: IOtpTriggerPhaseContextArgs): IOtpTriggerSeededDiagnostics {
  return {
    otpTriggerTarget: SYNTHETIC_TRIGGER_TARGET,
    otpPhoneHint: args.phoneHint,
    triggerClickedAt: 0,
    otpTriggerPreUrl: args.otpUrl,
  };
}
