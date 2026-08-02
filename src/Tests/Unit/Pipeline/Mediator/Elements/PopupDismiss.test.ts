/**
 * T-DISMISS — the obstruction-clearing primitive, including the late-overlay
 * case that shipped unnoticed.
 *
 * <p>Banks stagger their overlays. max.co.il paints its consent bar at once and
 * its marketing modal 21.3 s after DOMContentLoaded (measured). The probe used
 * the default race timeout for every attempt and returned at the first miss,
 * giving it a ~7 s window: it cleared the consent bar, looked once more, found
 * nothing, and reported the page clear — then the modal painted over it and
 * swallowed every click HOME made.
 *
 * <p>No layer caught that, because `dismissPopups` had no direct test at all.
 * T-DISMISS-1 fails against the pre-fix primitive.
 */

import type { IElementMediator } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import {
  dismissPopups,
  LATE_POPUP_WATCH_MS,
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

/** Records the timeout each dismissal attempt asked for; 0 = library default. */
interface IProbeRecorder {
  readonly mediator: IElementMediator;
  readonly timeouts: number[];
}

/** Describes when a scripted overlay becomes resolvable. */
interface IOverlayScript {
  /** Overlays visible immediately, consumed in order. */
  readonly immediate: number;
  /** True when one more overlay resolves only for a caller willing to wait. */
  readonly hasLateOverlay: boolean;
}

/**
 * Build a mediator that mimics a page whose overlays appear on a schedule.
 * A late overlay resolves only when the caller passes a long enough timeout —
 * exactly how a real race behaves against an element that has not painted yet.
 * @param script - Which overlays exist and when.
 * @returns Stub mediator plus the recorded per-attempt timeouts.
 */
function makeRecordingMediator(script: IOverlayScript): IProbeRecorder {
  const timeouts: number[] = [];
  const state = { immediateLeft: script.immediate };
  const mediator = {
    /**
     * Resolve a close control if one is visible to this caller.
     * @param _candidates - Ignored; the script decides.
     * @param timeoutMs - How long the caller is willing to wait.
     * @returns Succeed with found=true when an overlay resolves.
     */
    resolveAndClick: (_candidates: unknown, timeoutMs?: number): Promise<unknown> => {
      const waited = timeoutMs ?? 0;
      timeouts.push(waited);
      const isPatient = waited >= LATE_POPUP_WATCH_MS;
      const hasImmediate = state.immediateLeft > 0;
      if (hasImmediate) state.immediateLeft -= 1;
      const isFound = hasImmediate || (script.hasLateOverlay && isPatient);
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
  return { mediator, timeouts };
}

describe('PopupDismiss — obstruction clearing (T-DISMISS)', () => {
  it('T-DISMISS-1: clears a late overlay that paints after the first sweep', async () => {
    const { mediator } = makeRecordingMediator({ immediate: 1, hasLateOverlay: true });
    const dismissed = await dismissPopups(mediator, SILENT);
    expect(dismissed).toBe(2);
  });

  it('T-DISMISS-2: widens the wait only after something was dismissed', async () => {
    const { mediator, timeouts } = makeRecordingMediator({ immediate: 1, hasLateOverlay: true });
    await dismissPopups(mediator, SILENT);
    expect(timeouts).toEqual([0, LATE_POPUP_WATCH_MS]);
  });

  it('T-DISMISS-3: a clean page pays no extended wait', async () => {
    const { mediator, timeouts } = makeRecordingMediator({ immediate: 0, hasLateOverlay: false });
    const dismissed = await dismissPopups(mediator, SILENT);
    expect({ dismissed, probes: timeouts }).toEqual({ dismissed: 0, probes: [0] });
  });

  it('T-DISMISS-4: stops at the attempt cap on an endlessly popping page', async () => {
    const { mediator, timeouts } = makeRecordingMediator({ immediate: 99, hasLateOverlay: false });
    const dismissed = await dismissPopups(mediator, SILENT);
    expect({ dismissed, probeCount: timeouts.length }).toEqual({ dismissed: 2, probeCount: 2 });
  });
});
