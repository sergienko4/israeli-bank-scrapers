/**
 * BIND-API-MEDIATOR assembly wiring — the slot is dormant today: no
 * bank sets BOTH `hasBrowser` and `apiDirectScrape`, so it never
 * assembles for a current pipeline. These tests lock that invariant
 * AND the forward contract: once a browser bank is migrated to the
 * hard-model path, the generic AUTH-DISCOVERY / ACCOUNT-RESOLVE /
 * DASHBOARD / BALANCE-RESOLVE phases drop out and BIND-API-MEDIATOR
 * is inserted immediately before the api-direct SCRAPE.
 */

import type { IBuilderState } from '../../../../../Scrapers/Pipeline/Core/Builder/PipelineAssembly.js';
import { assemblePhases } from '../../../../../Scrapers/Pipeline/Core/Builder/PipelineAssembly.js';
import type { IApiDirectScrapeShape } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { BasePhase } from '../../../../../Scrapers/Pipeline/Types/BasePhase.js';

/** Truthy shape stub — only `.resultGuard` is read at construction. */
const SHAPE_STUB = {} as unknown as IApiDirectScrapeShape<unknown, unknown>;

/**
 * Build a builder-state stub. Defaults model a plain browser bank
 * with declarative login and NO api-direct shape.
 * @param overrides - Per-test overrides.
 * @returns Builder-state accepted by `assemblePhases`.
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
 * Map BasePhase[] to its `.name` string list.
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

describe('PipelineAssembly — BIND-API-MEDIATOR wiring', () => {
  it('omits bind-api-mediator and keeps the generic middle phases for a plain browser bank', () => {
    const state = makeState();
    const phases = assemblePhases(state);
    const names = phaseNames(phases);
    expect(names).not.toContain('bind-api-mediator');
    expect(names).toContain('auth-discovery');
    expect(names).toContain('account-resolve');
    expect(names).toContain('dashboard');
    expect(names).toContain('balance-resolve');
  });

  it('omits bind-api-mediator for a headless api-direct bank (no browser)', () => {
    const state = makeState({ hasBrowser: false, isHeadless: true, apiDirectScrape: SHAPE_STUB });
    const phases = assemblePhases(state);
    const names = phaseNames(phases);
    expect(names).not.toContain('bind-api-mediator');
  });

  it('drops the generic middle phases and inserts bind-api-mediator before api-direct scrape when migrated', () => {
    const state = makeState({ apiDirectScrape: SHAPE_STUB });
    const phases = assemblePhases(state);
    const names = phaseNames(phases);
    expect(names).not.toContain('auth-discovery');
    expect(names).not.toContain('account-resolve');
    expect(names).not.toContain('dashboard');
    expect(names).not.toContain('balance-resolve');
    const bindIdx = names.indexOf('bind-api-mediator');
    const scrapeIdx = names.indexOf('api-direct-scrape');
    expect(bindIdx).toBeGreaterThanOrEqual(0);
    expect(scrapeIdx).toBeGreaterThan(bindIdx);
  });

  it('keeps the browser login + terminate phases when migrated', () => {
    const state = makeState({ apiDirectScrape: SHAPE_STUB });
    const phases = assemblePhases(state);
    const names = phaseNames(phases);
    expect(names).toContain('init');
    expect(names).toContain('home');
    expect(names).toContain('login');
    expect(names).toContain('terminate');
  });
});
