/**
 * Unit tests for the SEQUENTIAL menu→child nav helpers in
 * DashboardPhaseActions — `safeProbeExactTextCount`,
 * `safeProbeDropdownToggleCount`, `findFirstChildInDom`,
 * `findDropdownToggleCandidate`, `buildDropdownToggleSelector`,
 * `tryDashboardSequentialNav`.
 *
 * These helpers were extracted to fire on Max's two-click dropdown path
 * (פעולות → פירוט החיובים והעסקאות) without affecting the other 6 banks.
 * Cross-bank validation lives in scripts/validate-trigger-v3.local.ts and
 * scripts/validate-max-sequential-v2.local.ts (offline, against captured
 * dashboard HTML); these unit tests cover the synchronous decision logic.
 */

import type { Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../../Scrapers/Base/Config/LoginConfigTypes.js';
import {
  buildDropdownToggleSelector,
  findDropdownToggleCandidate,
  findFirstChildInDom,
  safeProbeDropdownToggleCount,
  safeProbeExactTextCount,
  tryDashboardSequentialNav,
} from '../../../../Scrapers/Pipeline/Mediator/Dashboard/DashboardPhaseActions.js';

/** PII-safe error used by the throwing fake-page branches. */
class TestProbeError extends Error {
  /**
   * Construct with a fixed marker.
   */
  constructor() {
    super('test-probe');
    this.name = 'TestProbeError';
  }
}

/** Numeric DOM-match count returned by Playwright's locator.count(). */
type ProbeCount = number;

/** Fake-page configuration shape for `makeFakePage`. */
interface IFakePageSpec {
  readonly exactTextCounts?: Record<string, ProbeCount>;
  readonly toggleCounts?: Record<string, ProbeCount>;
  readonly shouldThrowOnExact?: boolean;
  readonly shouldThrowOnLocator?: boolean;
}

/**
 * Build a Page mock where getByText().count() and locator().filter().count()
 * return values from the supplied lookups (keyed by candidate text).
 * @param spec - Fake-page spec.
 * @param spec.exactTextCounts - Text → count map for getByText.
 * @param spec.toggleCounts - Text → count map for locator.filter.
 * @param spec.shouldThrowOnExact - Make getByText throw synchronously.
 * @param spec.shouldThrowOnLocator - Make locator throw synchronously.
 * @returns A typed Page mock with only the surface SEQUENTIAL nav uses.
 */
function makeFakePage(spec: IFakePageSpec): Page {
  const exactCounts = spec.exactTextCounts ?? {};
  const toggleCounts = spec.toggleCounts ?? {};
  const isThrowExact = !!spec.shouldThrowOnExact;
  const isThrowLocator = !!spec.shouldThrowOnLocator;
  const fake = {
    /**
     * Stub for page.getByText — returns an object exposing count().
     * @param value - Exact text to look up.
     * @returns Locator-like with count.
     */
    getByText: (value: string): { count: () => Promise<ProbeCount> } => {
      if (isThrowExact) throw new TestProbeError();
      return {
        /**
         * Resolve the looked-up DOM count.
         * @returns DOM count from the lookup table.
         */
        count: (): Promise<ProbeCount> => Promise.resolve(exactCounts[value] ?? 0),
      };
    },
    /**
     * Stub for page.locator(...).filter(...).count().
     * @returns Locator-like with filter+count.
     */
    locator: (): {
      filter: (opts: { hasText: string }) => { count: () => Promise<ProbeCount> };
    } => {
      if (isThrowLocator) throw new TestProbeError();
      return {
        /**
         * Filter by hasText.
         * @param opts - Filter spec.
         * @param opts.hasText - hasText value to match.
         * @returns Locator-like with count.
         */
        filter: (opts: { hasText: string }): { count: () => Promise<ProbeCount> } => ({
          /**
           * Resolve the looked-up dropdown-toggle count.
           * @returns DOM count from the toggle lookup table.
           */
          count: (): Promise<ProbeCount> => Promise.resolve(toggleCounts[opts.hasText] ?? 0),
        }),
      };
    },
  };
  return fake as unknown as Page;
}

const TXN_TEXT = 'פירוט החיובים והעסקאות';
const TRIGGER_TEXT = 'פעולות';

describe('safeProbeExactTextCount', () => {
  it('returns DOM count when getByText resolves', async () => {
    const page = makeFakePage({ exactTextCounts: { [TXN_TEXT]: 1 } });
    const n = await safeProbeExactTextCount(page, TXN_TEXT);
    expect(n).toBe(1);
  });

  it('returns 0 when getByText throws synchronously', async () => {
    const page = makeFakePage({ shouldThrowOnExact: true });
    const n = await safeProbeExactTextCount(page, TXN_TEXT);
    expect(n).toBe(0);
  });
});

describe('safeProbeDropdownToggleCount', () => {
  it('returns DOM count when locator resolves', async () => {
    const page = makeFakePage({ toggleCounts: { [TRIGGER_TEXT]: 1 } });
    const n = await safeProbeDropdownToggleCount(page, TRIGGER_TEXT);
    expect(n).toBe(1);
  });

  it('returns 0 when locator throws synchronously', async () => {
    const page = makeFakePage({ shouldThrowOnLocator: true });
    const n = await safeProbeDropdownToggleCount(page, TRIGGER_TEXT);
    expect(n).toBe(0);
  });
});

describe('findFirstChildInDom', () => {
  it('skips non-exactText candidates', async () => {
    const page = makeFakePage({});
    const candidates: readonly SelectorCandidate[] = [
      { kind: 'textContent', value: 'irrelevant' },
      { kind: 'ariaLabel', value: 'irrelevant' },
    ];
    const r = await findFirstChildInDom(page, candidates);
    expect(r).toBe(false);
  });

  it('returns false when no exactText candidate matches in DOM', async () => {
    const page = makeFakePage({ exactTextCounts: { [TXN_TEXT]: 0 } });
    const candidates: readonly SelectorCandidate[] = [{ kind: 'exactText', value: TXN_TEXT }];
    const r = await findFirstChildInDom(page, candidates);
    expect(r).toBe(false);
  });

  it('returns the first matching exactText candidate', async () => {
    const page = makeFakePage({ exactTextCounts: { [TXN_TEXT]: 1 } });
    const candidates: readonly SelectorCandidate[] = [
      { kind: 'textContent', value: 'misc' },
      { kind: 'exactText', value: TXN_TEXT },
    ];
    const r = await findFirstChildInDom(page, candidates);
    expect(r).toEqual({ kind: 'exactText', value: TXN_TEXT });
  });
});

describe('findDropdownToggleCandidate', () => {
  it('skips kinds other than textContent and exactText', async () => {
    const page = makeFakePage({});
    const candidates: readonly SelectorCandidate[] = [{ kind: 'ariaLabel', value: TRIGGER_TEXT }];
    const r = await findDropdownToggleCandidate(page, candidates);
    expect(r).toBe(false);
  });

  it('returns false when no candidate matches a dropdown-toggle', async () => {
    const page = makeFakePage({ toggleCounts: { [TRIGGER_TEXT]: 0 } });
    const candidates: readonly SelectorCandidate[] = [{ kind: 'textContent', value: TRIGGER_TEXT }];
    const r = await findDropdownToggleCandidate(page, candidates);
    expect(r).toBe(false);
  });

  it('rejects ambiguous matches (count > 1) — discriminator must be unique', async () => {
    const page = makeFakePage({ toggleCounts: { [TRIGGER_TEXT]: 3 } });
    const candidates: readonly SelectorCandidate[] = [{ kind: 'textContent', value: TRIGGER_TEXT }];
    const r = await findDropdownToggleCandidate(page, candidates);
    expect(r).toBe(false);
  });

  it('returns the candidate whose dropdown-toggle is unique', async () => {
    const page = makeFakePage({ toggleCounts: { [TRIGGER_TEXT]: 1 } });
    const candidates: readonly SelectorCandidate[] = [
      { kind: 'textContent', value: 'noise' },
      { kind: 'textContent', value: TRIGGER_TEXT },
    ];
    const r = await findDropdownToggleCandidate(page, candidates);
    expect(r).toEqual({ kind: 'textContent', value: TRIGGER_TEXT });
  });
});

describe('buildDropdownToggleSelector', () => {
  it('combines the [dropdowntoggle] directive with :has-text(...)', () => {
    const sel = buildDropdownToggleSelector(TRIGGER_TEXT);
    expect(sel).toBe(`[dropdowntoggle]:has-text("${TRIGGER_TEXT}")`);
  });
});

describe('tryDashboardSequentialNav', () => {
  it('returns false when no exactText child candidate is in the DOM', async () => {
    const page = makeFakePage({ exactTextCounts: {}, toggleCounts: { [TRIGGER_TEXT]: 1 } });
    const r = await tryDashboardSequentialNav(page);
    expect(r).toBe(false);
  });

  it('returns false when child exists but no dropdown-toggle matches', async () => {
    const page = makeFakePage({ exactTextCounts: { [TXN_TEXT]: 1 }, toggleCounts: {} });
    const r = await tryDashboardSequentialNav(page);
    expect(r).toBe(false);
  });

  it('returns full IDashboardTargets when child + trigger both match', async () => {
    const page = makeFakePage({
      exactTextCounts: { [TXN_TEXT]: 1 },
      toggleCounts: { [TRIGGER_TEXT]: 1 },
    });
    const r = await tryDashboardSequentialNav(page);
    expect(r).not.toBe(false);
    if (r) {
      expect(r.menuTarget).not.toBe(false);
      expect(r.clickTarget).not.toBe(false);
      if (r.menuTarget) {
        expect(r.menuTarget.selector).toBe(`[dropdowntoggle]:has-text("${TRIGGER_TEXT}")`);
        expect(r.menuTarget.candidateValue).toBe(TRIGGER_TEXT);
        expect(r.menuTarget.kind).toBe('css');
      }
      if (r.clickTarget) {
        expect(r.clickTarget.candidateValue).toBe(TXN_TEXT);
        expect(r.clickTarget.kind).toBe('exactText');
      }
      expect(r.hrefTarget).toBe('');
      expect(r.fallbackSelector).toBe('');
      expect(r.clickCandidateCount).toBe(0);
    }
  });
});
