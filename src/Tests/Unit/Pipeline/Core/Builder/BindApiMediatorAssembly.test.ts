/**
 * BIND-API-MEDIATOR assembly wiring — the slot is dormant today: no
 * bank sets BOTH `hasBrowser` and `apiDirectScrape`, so it never
 * assembles for a current pipeline. These tests lock that invariant
 * AND the forward contract: once a browser bank is migrated to the
 * hard-model path, BIND-API-MEDIATOR is inserted between DASHBOARD
 * and the api-direct SCRAPE.
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
  it('omits bind-api-mediator for a plain browser bank (no api-direct shape)', () => {
    const state = makeState();
    const phases = assemblePhases(state);
    const names = phaseNames(phases);
    expect(names).not.toContain('bind-api-mediator');
  });

  it('omits bind-api-mediator for a headless api-direct bank (no browser)', () => {
    const state = makeState({ hasBrowser: false, isHeadless: true, apiDirectScrape: SHAPE_STUB });
    const phases = assemblePhases(state);
    const names = phaseNames(phases);
    expect(names).not.toContain('bind-api-mediator');
  });

  it('inserts bind-api-mediator between dashboard and api-direct scrape when migrated', () => {
    const state = makeState({ apiDirectScrape: SHAPE_STUB });
    const phases = assemblePhases(state);
    const names = phaseNames(phases);
    const dashIdx = names.indexOf('dashboard');
    const bindIdx = names.indexOf('bind-api-mediator');
    const scrapeIdx = names.indexOf('api-direct-scrape');
    expect(bindIdx).toBeGreaterThan(dashIdx);
    expect(scrapeIdx).toBeGreaterThan(bindIdx);
  });
});
