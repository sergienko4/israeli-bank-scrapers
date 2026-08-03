/**
 * T-SESS — per-bank browser session persistence.
 *
 * <p>Every run launched a cold Camoufox, so banks saw a first-time visitor on
 * every request. From a datacenter IP that is the profile edge WAFs challenge:
 * Hapoalim answered our first navigation with an hCaptcha and Discount's origin
 * returned an Akamai 404, both before HOME ran a single locator.
 *
 * <p>T-SESS-1 pins the safety property that matters most: with the feature off
 * the pipeline builds exactly the context it built before.
 */

import { buildContextOptions } from '../../../../../Scrapers/Pipeline/Mediator/Browser/BrowserContextBuilder.js';
import {
  loadSessionState,
  SESSION_ROOT_ENV,
  sessionFileFor,
} from '../../../../../Scrapers/Pipeline/Mediator/Browser/BrowserSessionStore.js';

describe('BrowserSessionStore — per-bank session reuse (T-SESS)', () => {
  const original = process.env[SESSION_ROOT_ENV] ?? '';

  afterEach(() => {
    process.env[SESSION_ROOT_ENV] = original;
  });

  it('T-SESS-1 (FIRING): stays off, and cold, when the root is unset', () => {
    process.env[SESSION_ROOT_ENV] = '';
    const file = sessionFileFor('hapoalim');
    const loaded = loadSessionState('hapoalim');
    const opts = buildContextOptions(loaded);
    expect({ file, loaded, hasState: 'storageState' in opts }).toEqual({
      file: false,
      loaded: false,
      hasState: false,
    });
  });

  it('T-SESS-2: keys the session per bank so cookies never cross origins', () => {
    process.env[SESSION_ROOT_ENV] = '/tmp/sessions';
    const hapoalim = sessionFileFor('hapoalim');
    const discount = sessionFileFor('discount');
    const isDistinct = hapoalim !== discount;
    expect({ isDistinct, hasBoth: hapoalim !== false && discount !== false }).toEqual({
      isDistinct: true,
      hasBoth: true,
    });
  });

  it('T-SESS-3: reports no session when the bank has never been saved', () => {
    process.env[SESSION_ROOT_ENV] = '/tmp/sessions-that-do-not-exist';
    const loaded = loadSessionState('hapoalim');
    expect(loaded).toBe(false);
  });

  it('T-SESS-4: restores the saved session into the context options', () => {
    const opts = buildContextOptions('/tmp/sessions/hapoalim.session.json');
    expect(opts.storageState).toBe('/tmp/sessions/hapoalim.session.json');
  });
});
