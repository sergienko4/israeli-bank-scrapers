/**
 * Shared test doubles for the Telegram OTP fetcher suites.
 *
 * <p>`TelegramOtpFetcher.test.ts` pins the fetcher's polling and
 * failure taxonomy; `TelegramOtpPromptRetry.test.ts` pins the send
 * retry ladder with `humanDelay` mocked out. Both need the same
 * logger and `Response` doubles, so they live here rather than being
 * declared twice — a divergence between the two copies is exactly
 * how a stub stops resembling the contract it stands in for.
 *
 * <p>Deliberately NOT shared: each suite's `makeArgs`. They differ in
 * signature and in `timeoutMs` (2 s vs the 1 ms floor) because one
 * exercises the poll loop and the other must fall straight out of it.
 */

import { jest } from '@jest/globals';

/** Minimal pino-shaped logger for tests. */
export interface ITestLogger {
  readonly trace: jest.Mock;
  readonly debug: jest.Mock;
  readonly info: jest.Mock;
  readonly warn: jest.Mock;
  readonly error: jest.Mock;
}

/**
 * Build a fresh stub logger.
 * @returns Logger with every method as `jest.fn()`.
 */
export function makeStubLogger(): ITestLogger {
  return {
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

/** HTTP-level rejection knobs for a stubbed `sendMessage`. */
export interface IHttpFailure {
  readonly status: number;
  readonly statusText: string;
  readonly body: Record<string, unknown>;
}

/**
 * Build a rejected Response stub (`ok:false`) so the fetcher takes
 * its HTTP-error branch rather than the `ok:false` envelope branch.
 *
 * <p>`status` and `statusText` are always populated because a real
 * `Response` always carries them; a stub omitting them makes an
 * envelope-level rejection indistinguishable from a transport fault.
 *
 * @param failure - Status/body knobs.
 * @returns Response stub.
 */
export function makeFailedResponse(failure: IHttpFailure): Response {
  /**
   * Body accessor for the stub.
   * @returns The queued body.
   */
  const json = (): Promise<unknown> => Promise.resolve(failure.body);
  const stub = { ok: false, status: failure.status, statusText: failure.statusText, json };
  return stub as unknown as Response;
}
