/**
 * WafChallenge — tunable constants for the generic background WAF
 * checkbox-challenge interceptor.
 *
 * Bank-agnostic + phase-agnostic by design: any browser-flow bank whose
 * WAF (Imperva / Cloudflare) interleaves a hCaptcha or Turnstile checkbox
 * challenge into the navigation flow benefits transparently.
 *
 * Default timings follow the documented Camoufox auto-pass recipe
 * (camoufox.com/python/usage — "Avoiding the bot detection" section):
 * settle network -> wait 5 s for challenge hydration -> single mouse
 * click on the iframe centre. Camoufox C++ humanize handles the
 * cursor approach + click timing so a real cookie/token is emitted.
 */

/** Polling interval (ms) — how often we scan for a freshly mounted challenge frame. */
const WAF_POLL_INTERVAL_MS = 2000;

/** Networkidle ceiling (ms) before we consider the page "settled enough" to click. */
const WAF_NETWORK_IDLE_TIMEOUT_MS = 15000;

/** Static settle (ms) after networkidle — lets the challenge JS finish bootstrapping. */
const WAF_HYDRATION_WAIT_MS = 5000;

/** Cool-down (ms) between solve attempts on the same frame to avoid hammering. */
const WAF_SOLVE_COOLDOWN_MS = 8000;

/** hCaptcha CHECKBOX iframe URL substring.
 *
 * <p>The widget renders TWO iframes: one with `#frame=checkbox` (visible,
 * user-clickable) and one with `#frame=challenge` (the puzzle modal,
 * hidden until challenge required). We must only click the checkbox —
 * clicking the centre of the puzzle modal would not solve it. The
 * `#frame=checkbox` fragment is canonical in hCaptcha's hosted widget. */
const HCAPTCHA_IFRAME_URL_PATTERNS = ['hcaptcha.html#frame=checkbox'] as const;

/** Cloudflare Turnstile challenge frame URL substrings. */
const TURNSTILE_IFRAME_URL_PATTERNS = [
  'challenges.cloudflare.com/cdn-cgi/challenge-platform',
] as const;

/** Env var — set to '1' / 'true' to disable the interceptor (bisect / debug). */
const WAF_INTERCEPTOR_DISABLED_ENV = 'WAF_INTERCEPTOR_DISABLED';

export {
  HCAPTCHA_IFRAME_URL_PATTERNS,
  TURNSTILE_IFRAME_URL_PATTERNS,
  WAF_HYDRATION_WAIT_MS,
  WAF_INTERCEPTOR_DISABLED_ENV,
  WAF_NETWORK_IDLE_TIMEOUT_MS,
  WAF_POLL_INTERVAL_MS,
  WAF_SOLVE_COOLDOWN_MS,
};
