/**
 * AuthFailureWatcher Types — shared types + sentinel constants used by
 * every sub-module under Mediator/Network/AuthFailureWatcher/.
 *
 * No runtime side effects.
 */

import type { Request, Response } from 'playwright-core';

import type { JsonValue } from '../../../Types/JsonValue.js';

/** Body preview is masked + truncated to this length before logging. */
export const BODY_PREVIEW_LIMIT = 256;

/** HTTP status range counted as a credential rejection. */
export const FAIL_STATUS_MIN = 400;

/** HTTP status range counted as a credential rejection (inclusive upper). */
export const FAIL_STATUS_MAX = 499;

/** Sentinel returned by safeParsedBody when no JSON could be parsed. */
export const NO_PARSED_BODY = '__NO_PARSED_BODY__';

/** Classifier label distinguishing which detector layer fired. */
export type AuthFailureClassifier = 'http-4xx' | 'body-error';

/** Pattern row matching a body field whose value indicates an auth failure. */
export interface IBodyFailurePattern {
  /** JSON field name to inspect on the parsed response body. */
  readonly field: string;
  /** Predicate — true means this value denotes an auth failure. */
  readonly isFailure: (value: JsonValue) => boolean;
  /** Documents which bank's contract motivated the row. */
  readonly note: string;
}

/** Auth-failure record produced by either detection layer. */
export interface IAuthFailure {
  /** HTTP status code observed (200 for body-error layer, 4xx for status layer). */
  readonly status: number;
  /** Auth endpoint URL that failed. */
  readonly url: string;
  /** Truncated, masked body preview for diagnostics. */
  readonly bodyPreview: string;
  /** Which detection layer fired. */
  readonly classifier: AuthFailureClassifier;
}

/** Public watcher contract consumed by the LoginPhase. */
export interface IAuthFailureWatcher {
  /**
   * Resolve with the next observed auth failure, or false on timeout.
   * Returns the existing failure synchronously if one was already seen.
   */
  readonly waitForFailure: (timeoutMs: number) => Promise<IAuthFailure | false>;
  /** Synchronous probe — a captured failure if any, false otherwise. */
  readonly hasFailed: () => false | IAuthFailure;
  /** Clear any captured failure (used between retry attempts). */
  readonly reset: () => boolean;
  /** Stop listening — called when the LoginPhase exits. */
  readonly dispose: () => boolean;
}

/** Internal mutable state of an active watcher instance. */
export interface IWatcherState {
  detected: false | IAuthFailure;
  /**
   * Always set immediately by createAuthFailureWatcher; non-nullable so
   * disposeFn can call page.off without a runtime guard.
   */
  responseHandler: (response: Response) => boolean;
  requestHandler: false | ((request: Request) => boolean);
  requestFailedHandler: false | ((request: Request) => boolean);
  isDisposed: boolean;
}
