/**
 * Phase 7 — builder auto-binds ACCOUNT-RESOLVE for every browser
 * pipeline. Locked-down: insertion BETWEEN auth (LOGIN/OTP-*) AND
 * DASHBOARD; absent for headless/no-login pipelines; trace-gate
 * boundary moved earlier so id-bearing auth-side captures land in
 * the discovery pool.
 */

import type { IBuilderState } from '../../../../../Scrapers/Pipeline/Core/Builder/PipelineAssembly.js';
import { assemblePhases } from '../../../../../Scrapers/Pipeline/Core/Builder/PipelineAssembly.js';
import { resolveTraceBoundaryPhase } from '../../../../../Scrapers/Pipeline/Core/Builder/PipelineBuilderHelpers.js';
import type { BasePhase } from '../../../../../Scrapers/Pipeline/Types/BasePhase.js';

/**
 * Build a builder-state stub. Defaults model a non-OTP browser bank
 * with declarative login (Discount/Visacal/Amex/Isracard shape).
 * @param overrides - Per-test overrides.
 * @returns Builder-state shape accepted by `assemblePhases`.
 */
function makeState(overrides: Partial<IBuilderState> = {}): IBuilderState {
  const defaults: IBuilderState = {
    hasBrowser: true,
    isHeadless: false,
    hasPreLogin: false,
    hasOtpFill: false,
    otpFillRequired: false,
    hasOtpTrigger: false,
    loginMode: 'declarative',
    loginConfig: false,
    loginFn: false,
    scrapeFn: false,
    apiDirectScrape: false,
    apiDirectConfig: false,
  };
  return { ...defaults, ...overrides };
}

/**
 * Map BasePhase[] to its `.name` string list. Pulled out so each
 * test can stay flat (no nested-call lint trips).
 * @param phases - Assembled phase array.
 * @returns Names in the same order.
 */
function phaseNames(phases: readonly BasePhase[]): readonly string[] {
  /**
   * Project a BasePhase to its name string.
   * @param p - Phase instance.
   * @returns Phase name.
   */
  const toName = (p: BasePhase): string => p.name;
  return phases.map(toName);
}

describe('PipelineAssembly — ACCOUNT-RESOLVE auto-bind (Phase 7)', () => {
  it('inserts ACCOUNT-RESOLVE between LOGIN and DASHBOARD for non-OTP browser bank', () => {
    const state = makeState();
    const phases = assemblePhases(state);
    const names = phaseNames(phases);
    const loginIdx = names.indexOf('login');
    const arIdx = names.indexOf('account-resolve');
    const dashIdx = names.indexOf('dashboard');
    expect(loginIdx).toBeGreaterThanOrEqual(0);
    expect(arIdx).toBeGreaterThan(loginIdx);
    expect(dashIdx).toBeGreaterThan(arIdx);
  });

  it('inserts ACCOUNT-RESOLVE between OTP-FILL and DASHBOARD for OTP bank', () => {
    const state = makeState({
      hasOtpFill: true,
      hasOtpTrigger: true,
      otpFillRequired: true,
    });
    const phases = assemblePhases(state);
    const names = phaseNames(phases);
    const otpIdx = names.indexOf('otp-fill');
    const arIdx = names.indexOf('account-resolve');
    const dashIdx = names.indexOf('dashboard');
    expect(otpIdx).toBeGreaterThanOrEqual(0);
    expect(arIdx).toBeGreaterThan(otpIdx);
    expect(dashIdx).toBeGreaterThan(arIdx);
  });

  it('omits ACCOUNT-RESOLVE for headless / no-browser pipelines', () => {
    const state = makeState({ hasBrowser: false, isHeadless: true });
    const phases = assemblePhases(state);
    const names = phaseNames(phases);
    expect(names).not.toContain('account-resolve');
  });
});

describe('resolveTraceBoundaryPhase — Phase 7 earlier boundary', () => {
  it('returns "pre-login" when PRE-LOGIN configured', () => {
    const state = makeState({ hasPreLogin: true });
    const boundary = resolveTraceBoundaryPhase(state);
    expect(boundary).toBe('pre-login');
  });

  it('returns "home" for non-OTP browser bank without PRE-LOGIN', () => {
    const state = makeState();
    const boundary = resolveTraceBoundaryPhase(state);
    expect(boundary).toBe('home');
  });

  it('returns "home" for OTP bank — OTP no longer pushes the boundary later', () => {
    const state = makeState({ hasOtpFill: true, hasOtpTrigger: true });
    const boundary = resolveTraceBoundaryPhase(state);
    expect(boundary).toBe('home');
  });

  it('returns empty string for headless pipelines', () => {
    const state = makeState({ hasBrowser: false });
    const boundary = resolveTraceBoundaryPhase(state);
    expect(boundary).toBe('');
  });

  it('returns empty string for no-login pipelines', () => {
    const state = makeState({ loginMode: 'none' });
    const boundary = resolveTraceBoundaryPhase(state);
    expect(boundary).toBe('');
  });
});
