/**
 * HOME.ACTION — bare-`#` hash fall-through re-click recovery.
 *
 * Visacal's `<a id="ccLoginDesktopBtn" href="#" onclick="">` login
 * trigger binds its open-login handler asynchronously. Under heavy CI
 * throttling the first click can fire before the handler binds, so the
 * anchor's default action runs, the URL degrades to a bare `#` (hash
 * fall-through), and no login modal/iframe renders — the pipeline then
 * fails at PRE-LOGIN (E2E run 27848824404, job 82429668784).
 * `executeDirectNavigation` now re-clicks the trigger (bounded) once the
 * page has settled and the handler has had time to bind.
 *
 * Test Case IDs:
 *   - HOME-FALLTHRU-001..005: `isHashFallthrough` predicate.
 *   - HOME-FALLTHRU-010: bare-`#` first click → re-click recovers (2 clicks).
 *   - HOME-FALLTHRU-011: persistent fall-through is bounded (3 clicks).
 *   - HOME-FALLTHRU-012: clean first-click navigation → no re-click.
 */

import {
  executeHomeNavigation,
  isHashFallthrough,
} from '../../../../../Scrapers/Pipeline/Mediator/Home/HomeActions.js';
import type { IHomeDiscovery } from '../../../../../Scrapers/Pipeline/Mediator/Home/HomeResolver.js';
import { NAV_STRATEGY } from '../../../../../Scrapers/Pipeline/Mediator/Home/HomeResolver.js';
import type { IResolvedTarget } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { SILENT_LOG as LOG } from './HomeActionsExtraHelpers.js';
import { makeRecordingExecutor } from './HomeActionSrpRecorder.js';

const BASE = 'https://www.cal-online.co.il/';

/**
 * Build a SEQUENTIAL discovery on Visacal's identity trigger selector
 * (the bank whose `<a href="#">` login control reproduces the bug).
 * @returns IHomeDiscovery with strategy=SEQUENTIAL.
 */
function makeSeqDiscovery(): IHomeDiscovery {
  const triggerTarget: IResolvedTarget = {
    contextId: 'main',
    selector: '[id="ccLoginDesktopBtn"]',
    kind: 'attribute',
    candidateValue: 'ccLoginDesktopBtn',
  };
  return { strategy: NAV_STRATEGY.SEQUENTIAL, triggerText: 'כניסה לחשבון', triggerTarget };
}

describe('isHashFallthrough — bare-# hash fall-through predicate', () => {
  it('HOME-FALLTHRU-001: bare # appended → true', () => {
    const isFallthrough = isHashFallthrough(BASE, `${BASE}#`);
    expect(isFallthrough).toBe(true);
  });

  it('HOME-FALLTHRU-002: real path navigation → false', () => {
    const isFallthrough = isHashFallthrough(BASE, `${BASE}login`);
    expect(isFallthrough).toBe(false);
  });

  it('HOME-FALLTHRU-003: non-empty fragment route (#/login) → false', () => {
    const isFallthrough = isHashFallthrough(BASE, `${BASE}#/login`);
    expect(isFallthrough).toBe(false);
  });

  it('HOME-FALLTHRU-004: identical URL → false', () => {
    const isFallthrough = isHashFallthrough(BASE, BASE);
    expect(isFallthrough).toBe(false);
  });

  it('HOME-FALLTHRU-005: query-string change → false', () => {
    const isFallthrough = isHashFallthrough(BASE, `${BASE}?ref=login`);
    expect(isFallthrough).toBe(false);
  });
});

describe('HOME.ACTION — re-clicks a bare-# hash fall-through trigger', () => {
  it('HOME-FALLTHRU-010: recovers when the handler binds on the 2nd click', async () => {
    const recorder = makeRecordingExecutor({ initialUrl: BASE });
    let clicks = 0;
    recorder.setOnClick((): true => {
      clicks += 1;
      return recorder.setUrl(clicks >= 2 ? `${BASE}login` : `${BASE}#`);
    });
    const discovery = makeSeqDiscovery();
    const didNavigate = await executeHomeNavigation(recorder.executor, discovery, LOG);
    expect(recorder.clickLog).toHaveLength(2);
    expect(didNavigate).toBe(true);
  });

  it('HOME-FALLTHRU-011: bounds persistent fall-through to MAX attempts', async () => {
    const recorder = makeRecordingExecutor({ initialUrl: BASE });
    recorder.setOnClick((): true => recorder.setUrl(`${BASE}#`));
    const discovery = makeSeqDiscovery();
    const didNavigate = await executeHomeNavigation(recorder.executor, discovery, LOG);
    expect(recorder.clickLog).toHaveLength(3);
    expect(didNavigate).toBe(false);
  });

  it('HOME-FALLTHRU-012: no re-click when the first click navigates cleanly', async () => {
    const recorder = makeRecordingExecutor({ initialUrl: BASE });
    recorder.setOnClick((): true => recorder.setUrl(`${BASE}login`));
    const discovery = makeSeqDiscovery();
    const didNavigate = await executeHomeNavigation(recorder.executor, discovery, LOG);
    expect(recorder.clickLog).toHaveLength(1);
    expect(didNavigate).toBe(true);
  });
});
