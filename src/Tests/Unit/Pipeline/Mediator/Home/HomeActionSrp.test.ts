/**
 * Phase 6 — HOME.ACTION SRP regression tests.
 *
 * Strict invariant tested at the production entry point
 * `executeHomeNavigation(executor, discovery, logger)` (the
 * IActionMediator path called from `HomePhase.action`):
 *
 *   ACTION must call `executor.clickElement(target)` ONLY for the
 *   PRE-resolved `triggerTarget`. Every selector passed to
 *   `clickElement` must be identity-based (starts with `[`, `#`,
 *   `xpath=`, or `//`). Never `text=<value>` — that path bypasses
 *   the resolver and can hit a different DOM element with the same
 *   visible text (Max BoG-promo regression).
 *
 * Cross-validated against pipeline.log of all 6 non-OTP banks
 * (`scripts/analyze-home-action-tiers.ts`): 5/6 already use
 * identity-based selectors; only Max's SEQUENTIAL fallback fired a
 * second click via raw `text=` and hit the wrong element. Phase 6
 * deletes the SEQUENTIAL second click, the `executeNavigateToLogin`
 * dead-code path, and the `tryFallbackNav` href-scan rescue.
 */

import { executeHomeNavigation } from '../../../../../Scrapers/Pipeline/Mediator/Home/HomeActions.js';
import type { IHomeDiscovery } from '../../../../../Scrapers/Pipeline/Mediator/Home/HomeResolver.js';
import { NAV_STRATEGY } from '../../../../../Scrapers/Pipeline/Mediator/Home/HomeResolver.js';
import type { IResolvedTarget } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { SILENT_LOG as LOG } from './HomeActionsExtraHelpers.js';
import { makeRecordingExecutor } from './HomeActionSrpRecorder.js';

/**
 * Build a DIRECT discovery with an identity-based trigger selector.
 * @returns IHomeDiscovery with strategy=DIRECT.
 */
function makeDirectDiscovery(): IHomeDiscovery {
  const triggerTarget: IResolvedTarget = {
    contextId: 'main',
    selector: '[id="personal-entrance"]',
    kind: 'attribute',
    candidateValue: 'personal-entrance',
  };
  return {
    strategy: NAV_STRATEGY.DIRECT,
    triggerText: 'Login',
    triggerTarget,
  };
}

/**
 * Build a SEQUENTIAL discovery — the strategy label survives Phase 6
 * even though ACTION takes the same single-click path as DIRECT.
 * @returns IHomeDiscovery with strategy=SEQUENTIAL.
 */
function makeSequentialDiscovery(): IHomeDiscovery {
  const triggerTarget: IResolvedTarget = {
    contextId: 'main',
    selector: '[id="personal-entrance"]',
    kind: 'attribute',
    candidateValue: 'personal-entrance',
  };
  return {
    strategy: NAV_STRATEGY.SEQUENTIAL,
    triggerText: 'Login',
    triggerTarget,
  };
}

/**
 * True iff the selector is identity-based (id/attr/xpath, not raw text).
 * @param selector - Selector to classify.
 * @returns True if identity-based.
 */
function isIdentitySelector(selector: string): boolean {
  if (selector.startsWith('text=')) return false;
  if (selector.startsWith('[')) return true;
  if (selector.startsWith('#')) return true;
  if (selector.startsWith('xpath=')) return true;
  if (selector.startsWith('//')) return true;
  return false;
}

describe('HOME.ACTION SRP — DIRECT clicks resolved triggerTarget once', () => {
  it('uses the triggerTarget identity selector (not text=)', async () => {
    const discovery = makeDirectDiscovery();
    const recorder = makeRecordingExecutor({ initialUrl: 'https://bank.example/' });
    recorder.setOnClick((): true => recorder.setUrl('https://bank.example/login'));
    await executeHomeNavigation(recorder.executor, discovery, LOG);
    const log = recorder.clickLog;
    expect(log).toHaveLength(1);
    expect(log[0].selector).toBe('[id="personal-entrance"]');
    const isOk = isIdentitySelector(log[0].selector);
    expect(isOk).toBe(true);
  });
});

describe('HOME.ACTION SRP — SEQUENTIAL must not re-resolve via text=', () => {
  it('NEVER calls executor.clickElement with a text=<value> selector', async () => {
    const discovery = makeSequentialDiscovery();
    const recorder = makeRecordingExecutor({ initialUrl: 'https://www.max.co.il/' });
    recorder.setOnClick((): true => recorder.setUrl('https://www.max.co.il/login'));
    await executeHomeNavigation(recorder.executor, discovery, LOG);
    const log = recorder.clickLog;
    const textCalls = log.filter((c): boolean => c.selector.startsWith('text='));
    expect(textCalls).toEqual([]);
    for (const c of log) {
      const isOk = isIdentitySelector(c.selector);
      expect(isOk).toBe(true);
    }
  });

  it('makes EXACTLY one click on the triggerTarget identity selector', async () => {
    const discovery = makeSequentialDiscovery();
    const recorder = makeRecordingExecutor({ initialUrl: 'https://www.max.co.il/' });
    recorder.setOnClick((): true => recorder.setUrl('https://www.max.co.il/login'));
    await executeHomeNavigation(recorder.executor, discovery, LOG);
    const log = recorder.clickLog;
    expect(log).toHaveLength(1);
    expect(log[0].selector).toBe('[id="personal-entrance"]');
    const isOk = isIdentitySelector(log[0].selector);
    expect(isOk).toBe(true);
  });
});

describe('HOME.ACTION SRP — does not silently fall back to href-scan', () => {
  it('no navigateTo calls when click did not navigate', async () => {
    const discovery = makeDirectDiscovery();
    const recorder = makeRecordingExecutor({
      initialUrl: 'https://bank.example/',
      hrefs: ['https://bank.example/some/login'],
    });
    // No setOnClick → URL stays unchanged after click. ACTION must
    // NOT silently rescue via collectAllHrefs() + navigateTo().
    await executeHomeNavigation(recorder.executor, discovery, LOG);
    expect(recorder.navigateLog).toEqual([]);
  });
});

/** Identity selectors observed for each non-OTP bank (live trace 2026-05-06). */
const BANK_TRIGGERS: readonly { readonly bank: string; readonly selector: string }[] = [
  { bank: 'discount', selector: '[class~="goto-discounts"]' },
  { bank: 'visacal', selector: '[id="ccLoginDesktopBtn"]' },
  { bank: 'hapoalim', selector: '[id="header-mega-link-כניסה לחשבון"]' },
  { bank: 'amex', selector: '[class~="DPAltb"]' },
  { bank: 'isracard', selector: '[class~="DPAltb"]' },
  { bank: 'max', selector: '[id="personal-entrance"]' },
];

/**
 * Run a DIRECT discovery for one bank fixture and return the click log.
 * Lifted out of `describe` per lint S7721 (async functions belong at module scope).
 * @param selector - Bank trigger selector.
 * @returns Click log entries.
 */
async function runDirectFor(
  selector: string,
): Promise<readonly { selector: string; contextId: string }[]> {
  const triggerTarget: IResolvedTarget = {
    contextId: 'main',
    selector,
    kind: 'attribute',
    candidateValue: 'fixture',
  };
  const discovery: IHomeDiscovery = {
    strategy: NAV_STRATEGY.DIRECT,
    triggerText: 'Login',
    triggerTarget,
  };
  const recorder = makeRecordingExecutor({ initialUrl: 'https://bank.example/' });
  recorder.setOnClick((): true => recorder.setUrl('https://bank.example/login'));
  await executeHomeNavigation(recorder.executor, discovery, LOG);
  return recorder.clickLog;
}

/** Pre-computed `[bank, selector]` table consumed by `it.each` below. */
const BANK_PARITY_TABLE: readonly [string, string][] = BANK_TRIGGERS.map(
  (b): [string, string] => [b.bank, b.selector],
);

describe('HOME.ACTION SRP — cross-bank parity (identity selectors only)', () => {
  it.each(BANK_PARITY_TABLE)(
    '%s: clicks the identity selector exactly once',
    async (_bank, selector): Promise<void> => {
      const log = await runDirectFor(selector);
      expect(log).toHaveLength(1);
      expect(log[0].selector).toBe(selector);
      const isOk = isIdentitySelector(log[0].selector);
      expect(isOk).toBe(true);
    },
  );
});
