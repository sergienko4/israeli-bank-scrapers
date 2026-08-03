/**
 * T-DISMISS — the obstruction-clearing primitive, and the dwell budget it
 * must never exceed.
 *
 * <p>A follow-up attempt once waited 30 s for a late overlay. Every bank that
 * shows any popup therefore held its homepage in a continuous multi-locator
 * race for half a minute: measured at **34 457 ms** for one Discount probe
 * against ~6 s before. Akamai answered a CI-runner IP with an edge block, and
 * HOME failed with "no login nav link found" on a page that was never the
 * homepage.
 *
 * <p>T-DISMISS-2 pins the budget: the probe may never ask for a longer wait
 * than the mediator's default. Late overlays belong to the sanitization
 * pulse, which re-probes after HOME.POST fails — later in wall-clock time
 * than any widened wait, at no idle cost.
 */

import type { IElementMediator } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import {
  dismissPopups,
  MAX_POPUP_ATTEMPTS,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/PopupDismiss.js';
import type { ScraperLogger } from '../../../../../Scrapers/Pipeline/Types/Debug.js';
import { succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

/** Silent logger — assertions carry the diagnostics. */
const SILENT = {
  /**
   * No-op debug.
   * @returns True.
   */
  debug: (): boolean => true,
} as unknown as ScraperLogger;

/** Records whether each attempt asked the mediator to wait longer than default. */
interface IProbeRecorder {
  readonly mediator: IElementMediator;
  readonly heldPage: boolean[];
}

/**
 * Build a mediator standing in for a page carrying `immediate` overlays,
 * consumed one per attempt.
 * @param immediate - How many overlays are visible right now.
 * @returns Stub mediator plus one flag per attempt.
 */
function makeRecordingMediator(immediate: number): IProbeRecorder {
  const heldPage: boolean[] = [];
  const state = { left: immediate };
  const mediator = {
    /**
     * Resolve a close control if one is still visible.
     * @param _candidates - Ignored; the script decides.
     * @param timeoutMs - Explicit race budget, when the caller supplies one.
     * @returns Succeed with found=true while overlays remain.
     */
    resolveAndClick: (_candidates: unknown, timeoutMs?: number): Promise<unknown> => {
      heldPage.push(timeoutMs !== undefined);
      const isFound = state.left > 0;
      if (isFound) state.left -= 1;
      const outcome = succeed({ found: isFound, value: 'close' });
      return Promise.resolve(outcome);
    },
    /**
     * Settle stub.
     * @returns Resolved immediately.
     */
    waitForNetworkIdle: (): Promise<unknown> => {
      const idle = succeed(undefined);
      return Promise.resolve(idle);
    },
  } as unknown as IElementMediator;
  return { mediator, heldPage };
}

describe('PopupDismiss — obstruction clearing (T-DISMISS)', () => {
  it('T-DISMISS-1: clears the overlays a page is showing', async () => {
    const { mediator } = makeRecordingMediator(1);
    const dismissed = await dismissPopups(mediator, SILENT);
    expect(dismissed).toBe(1);
  });

  it('T-DISMISS-2 (FIRING): never holds the page beyond the default wait', async () => {
    const { mediator, heldPage } = makeRecordingMediator(1);
    await dismissPopups(mediator, SILENT);
    expect(heldPage).toEqual([false, false]);
  });

  it('T-DISMISS-3: a clean page costs exactly one probe', async () => {
    const { mediator, heldPage } = makeRecordingMediator(0);
    const dismissed = await dismissPopups(mediator, SILENT);
    expect({ dismissed, probes: heldPage.length }).toEqual({ dismissed: 0, probes: 1 });
  });

  it('T-DISMISS-4: stops at the attempt cap on an endlessly popping page', async () => {
    const { mediator, heldPage } = makeRecordingMediator(MAX_POPUP_ATTEMPTS + 1);
    const dismissed = await dismissPopups(mediator, SILENT);
    expect({ dismissed, probes: heldPage.length }).toEqual({
      dismissed: MAX_POPUP_ATTEMPTS,
      probes: MAX_POPUP_ATTEMPTS,
    });
  });
});
