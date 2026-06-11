/**
 * `IDiscoveredEndpoint` — a captured API call recorded from browser
 * network traffic by the pipeline's network mediator. The companion
 * `PickerTier` literal union annotates *which* tier of the shape-aware
 * picker selected the capture so DASHBOARD's resolver can record the
 * decision in trace artefacts.
 *
 * Extracted from `Mediator/Network/NetworkDiscoveryTypes.ts` during
 * Phase 12c; the original file becomes a re-export barrel so the
 * 63 type-only importers continue to resolve unchanged.
 */

/**
 * Ordered tier label produced by `discoverShapeAware` to record which
 * stage of the picker matched. Ordered from cleanest to loosest match:
 *   - `postWithShape`     — real txns in body
 *   - `replayablePost`    — POST template; body may be empty
 *   - `shapePassing`      — shape gate passed but tier indeterminate
 *   - `preClickFallback`  — post-click pool empty; pre-click capture used
 *   - `urlOnlyMatch`      — URL pattern hit but no body (e.g. 204)
 *   - `windowParamsMatch` — URL + window-param shape match
 *   - `none`              — sentinel when no tier applied
 */
export type PickerTier =
  | 'postWithShape'
  | 'replayablePost'
  | 'shapePassing'
  | 'preClickFallback'
  | 'urlOnlyMatch'
  | 'windowParamsMatch'
  | 'none';

/** A discovered API endpoint — captured from browser network traffic. */
export interface IDiscoveredEndpoint {
  /** Full URL including query params. */
  readonly url: string;
  /** HTTP method (GET or POST). */
  readonly method: 'GET' | 'POST' | 'PUT';
  /** POST body if applicable. */
  readonly postData: string;
  /** Parsed JSON response body. */
  readonly responseBody: unknown;
  /** Response content type. */
  readonly contentType: string;
  /** Request headers sent by page JS (for auth token, origin, site ID). */
  readonly requestHeaders: Record<string, string>;
  /** Response headers from server (for CORS, content-type, cookies). */
  readonly responseHeaders: Record<string, string>;
  /** Capture timestamp (ms since epoch). */
  readonly timestamp: number;
  /**
   * Sequential capture index — same `dumpCounter` value used as the
   * filename prefix `NNNN-METHOD-stub.json` under the run's `network/`
   * folder. Lets a structured log line referencing this endpoint be
   * deterministically joined to its on-disk capture file via
   * `runId` + `captureIndex`. Optional: undefined when the endpoint
   * was synthesised without a dump (frozen replay, tests).
   */
  readonly captureIndex?: number;
  /**
   * Phase 7f — set by `discoverShapeAware` so DASHBOARD's resolver can
   * record which tier produced the pick. See {@link PickerTier} for the
   * ordered enumeration. Optional: undefined when synthesised in tests.
   */
  readonly pickerTier?: PickerTier;
  /**
   * Phase 7f — true when the picker fell back to the pre-click pool
   * because the post-click pool had no `WK_API.transactions` match.
   * Visacal-class banks where the real TRX URL fires at login-FINAL.
   * Optional: undefined when not set.
   */
  readonly capturedPreClick?: boolean;
  /**
   * Mission 4 — HTTP status code from the bank's response. Lets
   * OTP-TRIGGER.POST scope-bound validation distinguish a 2xx
   * SMS-trigger ACK from a 4xx/5xx server error since the click.
   * Optional: undefined when synthesised in tests or replays.
   */
  readonly status?: number;
}
