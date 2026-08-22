/**
 * Landing-status policy tests.
 *
 * <p>Guards the distinction that makes this policy safe: a terminal
 * status fails INIT, but a challenge-capable status must not — the
 * WAF-challenge interceptor resolves those later in the run, and
 * failing them here would break a flow that currently works.
 */

import type { Response } from 'playwright-core';

import {
  isTerminalLandingStatus,
  landingFailureMessage,
  readLandingStatus,
} from '../../../../../Scrapers/Pipeline/Mediator/Init/LandingStatus.js';

/**
 * Build a minimal stand-in for the `Response` that `page.goto` returns.
 * @param status - HTTP status the stand-in reports.
 * @returns Response-shaped object carrying that status.
 */
function makeResponse(status: number): Response {
  /**
   * Report the scripted status.
   * @returns The scripted status.
   */
  const reportStatus = (): number => status;
  return { status: reportStatus } as unknown as Response;
}

describe('readLandingStatus', () => {
  it('reads the status off the response goto already returned', () => {
    const response = makeResponse(404);
    const status = readLandingStatus(response);
    expect(status).toBe(404);
  });

  // A same-document navigation surfaces no response. Absence of a status
  // is not evidence of an error, so it must not read as one.
  it('reports a sentinel when there is no response', () => {
    const status = readLandingStatus(null);
    expect(status).toBe(0);
  });

  it('never treats the no-response sentinel as terminal', () => {
    const status = readLandingStatus(null);
    const isTerminal = isTerminalLandingStatus(status);
    expect(isTerminal).toBe(false);
  });

  // Never throw on the critical path: a throw here is caught by the
  // navigation handler and misreported as "navigation failed", turning a
  // healthy landing into a phantom failure.
  it('reports the sentinel when the driver hands back a malformed response', () => {
    const malformed = { status: 'not-a-function' } as unknown as Response;
    const status = readLandingStatus(malformed);
    expect(status).toBe(0);
  });

  it('reports the sentinel when status() yields a non-number', () => {
    /**
     * Report a non-numeric status.
     * @returns Nothing usable as a status.
     */
    const reportNothing = (): unknown => undefined;
    const malformed = { status: reportNothing } as unknown as Response;
    const status = readLandingStatus(malformed);
    expect(status).toBe(0);
  });
});

describe('isTerminalLandingStatus', () => {
  // The Discount failure this policy exists for: the first navigation
  // landed on the bank's branded 404 while every INIT stage said OK.
  it.each([404, 410])('treats %s as terminal — the document does not exist', status => {
    const isTerminal = isTerminalLandingStatus(status);
    expect(isTerminal).toBe(true);
  });

  // A challenge page commits with a non-2xx status before it resolves.
  // Hapoalim's hCaptcha has been recorded settling 1.5s AFTER HOME.PRE,
  // so failing INIT on these would break a working WAF bypass.
  it.each([403, 429, 503])('leaves challenge-capable %s to the interceptor', status => {
    const isTerminal = isTerminalLandingStatus(status);
    expect(isTerminal).toBe(false);
  });

  it.each([200, 302])('treats healthy %s as usable', status => {
    const isTerminal = isTerminalLandingStatus(status);
    expect(isTerminal).toBe(false);
  });
});

describe('landingFailureMessage', () => {
  // The message must attribute the failure to the bank's edge, not to
  // scrape logic — the distinction that previously cost a forensic
  // bundle download to establish.
  it('names the status so the run is attributable from the log alone', () => {
    const message = landingFailureMessage(404, 'https://bank.example');
    expect(message).toContain('404');
  });

  it('names the target so the failure points at a document', () => {
    const message = landingFailureMessage(410, 'https://bank.example');
    expect(message).toContain('https://bank.example');
  });
});
