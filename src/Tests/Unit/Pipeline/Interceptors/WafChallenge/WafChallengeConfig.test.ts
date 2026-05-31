/**
 * Unit tests for WafChallengeConfig — pinned constants + frozen env contract.
 *
 * <p>This is a canary: the configured timings and URL patterns are the
 * documented Camoufox auto-pass recipe. Silently relaxing them (e.g.
 * dropping the hydration wait to 0) would silently regress the WAF
 * interceptor on every bank using hCaptcha or Turnstile.
 */

import {
  HCAPTCHA_IFRAME_URL_PATTERNS,
  TURNSTILE_IFRAME_URL_PATTERNS,
  WAF_HYDRATION_WAIT_MS,
  WAF_INTERCEPTOR_DISABLED_ENV,
  WAF_NETWORK_IDLE_TIMEOUT_MS,
  WAF_POLL_INTERVAL_MS,
  WAF_SOLVE_COOLDOWN_MS,
} from '../../../../../Scrapers/Pipeline/Interceptors/WafChallenge/WafChallengeConfig.js';

describe('WafChallengeConfig', () => {
  it('pins the documented Camoufox hydration wait at 5s', () => {
    expect(WAF_HYDRATION_WAIT_MS).toBe(5000);
  });

  it('pins networkidle ceiling at 15s', () => {
    expect(WAF_NETWORK_IDLE_TIMEOUT_MS).toBe(15000);
  });

  it('keeps poll interval responsive (≤2s)', () => {
    expect(WAF_POLL_INTERVAL_MS).toBeLessThanOrEqual(2000);
  });

  it('keeps solve cool-down above hydration wait to avoid double-fire', () => {
    expect(WAF_SOLVE_COOLDOWN_MS).toBeGreaterThan(WAF_HYDRATION_WAIT_MS);
  });

  it('exposes the disable-env name as a stable string', () => {
    expect(WAF_INTERCEPTOR_DISABLED_ENV).toBe('WAF_INTERCEPTOR_DISABLED');
  });

  it('matches only the canonical hCaptcha CHECKBOX iframe (frame=checkbox fragment) and NOT the puzzle modal', () => {
    expect(HCAPTCHA_IFRAME_URL_PATTERNS).toContain('hcaptcha.html#frame=checkbox');
  });

  it('does not match the hCaptcha challenge (puzzle) iframe — clicking it would not solve', () => {
    const challengeUrl = 'hcaptcha.html#frame=challenge';
    const isMatched = HCAPTCHA_IFRAME_URL_PATTERNS.some((p): boolean => challengeUrl.includes(p));
    expect(isMatched).toBe(false);
  });

  it('matches the Cloudflare Turnstile platform substring', () => {
    expect(TURNSTILE_IFRAME_URL_PATTERNS).toContain(
      'challenges.cloudflare.com/cdn-cgi/challenge-platform',
    );
  });
});
