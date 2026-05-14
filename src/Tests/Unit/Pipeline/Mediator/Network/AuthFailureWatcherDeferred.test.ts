/**
 * AuthFailureWatcher deferred-attach contract.
 *
 * <p>BLUF: `createAuthFailureWatcher(page)` MUST NOT attach the
 * `page.on('response', ...)` listener synchronously. The listener
 * attaches only when the explicit {@link IAuthFailureWatcher#start}
 * helper is invoked by the central listener registry on
 * {@link INetworkDiscovery}.
 *
 * <p>Why this matters: Cloudflare's CDP/BiDi fingerprint observes the
 * listener subscription state during the WAF check window at HOME.
 * If the listener is attached at INIT.FINAL (Pipeline's wire-up
 * stage), Cloudflare can detect it on the next request and serve
 * an hCaptcha challenge — empirically confirmed by PR #228 CI run
 * 25844771660 Hapoalim job (`hapoalim-home-pre-fail-20260514-063537.png`
 * — Cloudflare "Additional security check is required" wall).
 *
 * <p>The fix routes attachment through `NetworkDiscovery`'s typed
 * registry. The lifecycle interceptor calls
 * `attachAuthFailureWatcher()` at LOGIN.PRE entry, past the HOME WAF
 * window. Phases never call `page.on(` directly (architectural fence
 * enforced by ESLint canary).
 *
 * <p>These tests are RED while `AuthFailureWatcher` still attaches in
 * its constructor, GREEN once the refactor lands.
 */

import type { Page, Response } from 'playwright-core';

import { createAuthFailureWatcher } from '../../../../../Scrapers/Pipeline/Mediator/Network/AuthFailureWatcher.js';

/** Listener signature accepted by `page.on('response', listener)`. */
type ResponseListener = (response: Response) => unknown;

/**
 * Build a Playwright-like Page stub that records every `on` / `off`
 * call against the `'response'` event. Pure synchronous capture — no
 * Playwright dependency. Returns the stub paired with the live state
 * record so tests can assert call counts.
 *
 * @returns Mock page plus the recorded state.
 */
function buildMockPage(): {
  page: Page;
  state: { attachments: ResponseListener[]; detachments: ResponseListener[] };
} {
  const attachments: ResponseListener[] = [];
  const detachments: ResponseListener[] = [];
  const page = {
    /**
     * Record an `on('response', listener)` attachment.
     * @param event - Event name (only `'response'` is recorded).
     * @param listener - Listener that would receive Response objects.
     * @returns The mock page (chainable like Playwright's Page).
     */
    on(event: string, listener: ResponseListener): Page {
      if (event === 'response') attachments.push(listener);
      return page;
    },
    /**
     * Record an `off('response', listener)` detachment.
     * @param event - Event name (only `'response'` is recorded).
     * @param listener - Listener that should be removed.
     * @returns The mock page (chainable).
     */
    off(event: string, listener: ResponseListener): Page {
      if (event === 'response') detachments.push(listener);
      return page;
    },
  } as unknown as Page;
  return { page, state: { attachments, detachments } };
}

describe('AuthFailureWatcher deferred-attach contract', () => {
  it('LISTENER-DEFER-001: createAuthFailureWatcher MUST NOT attach a response listener synchronously', () => {
    const { page, state } = buildMockPage();
    createAuthFailureWatcher(page);
    expect(state.attachments).toHaveLength(0);
  });

  it('LISTENER-DEFER-002: watcher exposes a start() helper that attaches the listener', () => {
    const { page, state } = buildMockPage();
    const watcher = createAuthFailureWatcher(page);
    const watcherWithStart = watcher as unknown as { start: () => boolean };
    expect(typeof watcherWithStart.start).toBe('function');
    watcherWithStart.start();
    expect(state.attachments).toHaveLength(1);
  });

  it('LISTENER-DEFER-003: start() is idempotent — second call does not double-attach', () => {
    const { page, state } = buildMockPage();
    const watcher = createAuthFailureWatcher(page);
    const watcherWithStart = watcher as unknown as { start: () => boolean };
    watcherWithStart.start();
    watcherWithStart.start();
    expect(state.attachments).toHaveLength(1);
  });

  it('LISTENER-DEFER-004: hasFailed() returns false before start() is called', () => {
    const { page } = buildMockPage();
    const watcher = createAuthFailureWatcher(page);
    const failureSnapshot = watcher.hasFailed();
    expect(failureSnapshot).toBe(false);
  });
});
