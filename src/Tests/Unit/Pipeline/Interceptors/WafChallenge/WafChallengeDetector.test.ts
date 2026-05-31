/**
 * Unit tests for WafChallengeDetector — frame URL classification.
 *
 * <p>Drives the detector with mock Frame/Page objects to assert the
 * provider-routing decision table without spinning up a real browser.
 */

import type { Frame, Page } from 'playwright-core';

import {
  classify,
  classifyOne,
  detectChallenge,
  frameMatches,
  isHit,
  listFramesSafe,
  safeFrameUrl,
} from '../../../../../Scrapers/Pipeline/Interceptors/WafChallenge/WafChallengeDetector.js';

const THROW_SENTINEL = '__throw__';

/**
 * Factory — build a Frame stub with the given URL behaviour.
 * @param url - URL the stub returns, or THROW_SENTINEL to simulate detached.
 * @returns A Frame-shaped mock for the detector.
 */
function makeFrameStub(url: string): Frame {
  return {
    /**
     * Mock url() — returns the configured string or throws.
     * @returns Stubbed URL string.
     */
    url: (): string => {
      if (url === THROW_SENTINEL) throw new TypeError('detached-test');
      return url;
    },
  } as unknown as Frame;
}

/**
 * Factory — build a Page stub whose frames() returns the given frames.
 * @param frames - Frames to return from page.frames().
 * @returns A Page-shaped mock for the detector.
 */
function makePageStub(frames: readonly Frame[]): Page {
  return {
    /**
     * Mock frames() — returns the configured array.
     * @returns Stubbed frame list.
     */
    frames: (): readonly Frame[] => frames,
  } as unknown as Page;
}

/**
 * Factory — build a Page stub whose frames() throws (closed page).
 * @returns A Page-shaped mock that simulates a closed page.
 */
function makeClosedPageStub(): Page {
  return {
    /**
     * Mock frames() — throws to simulate a closed page.
     * @returns Never (throws).
     */
    frames: (): readonly Frame[] => {
      throw new TypeError('closed-test');
    },
  } as unknown as Page;
}

describe('WafChallengeDetector.safeFrameUrl', () => {
  it('returns the URL when the frame is healthy', () => {
    const f = makeFrameStub('https://example.com');
    const url = safeFrameUrl(f);
    expect(url).toBe('https://example.com');
  });

  it('returns empty string when frame.url() throws', () => {
    const f = makeFrameStub(THROW_SENTINEL);
    const url = safeFrameUrl(f);
    expect(url).toBe('');
  });
});

describe('WafChallengeDetector.frameMatches', () => {
  it('returns true when URL contains a pattern', () => {
    const f = makeFrameStub('https://hcaptcha.com/captcha?x=1');
    const isMatched = frameMatches(f, ['hcaptcha.com/captcha']);
    expect(isMatched).toBe(true);
  });

  it('returns false when no pattern matches', () => {
    const f = makeFrameStub('https://example.com');
    const isMatched = frameMatches(f, ['hcaptcha.com/captcha']);
    expect(isMatched).toBe(false);
  });

  it('returns false when frame URL is empty', () => {
    const f = makeFrameStub(THROW_SENTINEL);
    const isMatched = frameMatches(f, ['hcaptcha.com']);
    expect(isMatched).toBe(false);
  });
});

describe('WafChallengeDetector.classify', () => {
  it('returns "hcaptcha-checkbox" for the canonical hCaptcha checkbox iframe URL', () => {
    const f = makeFrameStub(
      'https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html#frame=checkbox&id=foo',
    );
    const kind = classify(f);
    expect(kind).toBe('hcaptcha-checkbox');
  });

  it('returns the NO_KIND sentinel for the hCaptcha challenge (puzzle) iframe — we never click puzzles', () => {
    const f = makeFrameStub(
      'https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html#frame=challenge&id=foo',
    );
    const kind = classify(f);
    expect(kind).toBe('');
  });

  it('returns "turnstile-checkbox" for Cloudflare Turnstile URLs', () => {
    const f = makeFrameStub('https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/v1/x');
    const kind = classify(f);
    expect(kind).toBe('turnstile-checkbox');
  });

  it('returns the NO_KIND sentinel for unrelated URLs', () => {
    const f = makeFrameStub('https://bank.example.com/login');
    const kind = classify(f);
    expect(kind).toBe('');
  });
});

describe('WafChallengeDetector.classifyOne', () => {
  it('emits Some on a recognised challenge iframe', () => {
    const f = makeFrameStub(
      'https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html#frame=checkbox&id=xyz',
    );
    const result = classifyOne(f);
    expect(result.has).toBe(true);
    if (result.has) {
      expect(result.value.kind).toBe('hcaptcha-checkbox');
      expect(result.value.frame).toBe(f);
    }
  });

  it('emits None on an unrecognised frame', () => {
    const f = makeFrameStub('https://example.com');
    const result = classifyOne(f);
    expect(result.has).toBe(false);
  });
});

describe('WafChallengeDetector.isHit', () => {
  it('returns true when option is Some', () => {
    const f = makeFrameStub(
      'https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html#frame=checkbox',
    );
    const opt = classifyOne(f);
    const wasHit = isHit(opt);
    expect(wasHit).toBe(true);
  });

  it('returns false when option is None', () => {
    const f = makeFrameStub('https://example.com');
    const opt = classifyOne(f);
    const wasHit = isHit(opt);
    expect(wasHit).toBe(false);
  });
});

describe('WafChallengeDetector.listFramesSafe', () => {
  it('returns the frame list when page is healthy', () => {
    const f = makeFrameStub('https://example.com');
    const page = makePageStub([f]);
    const list = listFramesSafe(page);
    expect(list).toEqual([f]);
  });

  it('returns empty array when frames() throws', () => {
    const page = makeClosedPageStub();
    const list = listFramesSafe(page);
    expect(list).toEqual([]);
  });
});

describe('WafChallengeDetector.detectChallenge', () => {
  it('returns Some on a page with an hCaptcha iframe', () => {
    const hit = makeFrameStub(
      'https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html#frame=checkbox&id=foo',
    );
    const benign = makeFrameStub('https://bank.example.com/login');
    const page = makePageStub([benign, hit]);
    const result = detectChallenge(page);
    expect(result.has).toBe(true);
    if (result.has) expect(result.value.kind).toBe('hcaptcha-checkbox');
  });

  it('skips the hCaptcha puzzle iframe and only returns the checkbox iframe', () => {
    const puzzle = makeFrameStub(
      'https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html#frame=challenge&id=foo',
    );
    const checkbox = makeFrameStub(
      'https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html#frame=checkbox&id=foo',
    );
    const page = makePageStub([puzzle, checkbox]);
    const result = detectChallenge(page);
    expect(result.has).toBe(true);
    if (result.has) expect(result.value.frame).toBe(checkbox);
  });

  it('returns Some on a page with a Turnstile iframe', () => {
    const hit = makeFrameStub('https://challenges.cloudflare.com/cdn-cgi/challenge-platform/x');
    const page = makePageStub([hit]);
    const result = detectChallenge(page);
    expect(result.has).toBe(true);
    if (result.has) expect(result.value.kind).toBe('turnstile-checkbox');
  });

  it('returns None on a page with no challenges', () => {
    const benign = makeFrameStub('https://bank.example.com/login');
    const page = makePageStub([benign]);
    const result = detectChallenge(page);
    expect(result.has).toBe(false);
  });

  it('returns None when page.frames() throws (closed page)', () => {
    const page = makeClosedPageStub();
    const result = detectChallenge(page);
    expect(result.has).toBe(false);
  });

  it('finds the first challenge frame when multiple match', () => {
    const a = makeFrameStub(
      'https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html#frame=checkbox&id=a',
    );
    const b = makeFrameStub(
      'https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html#frame=checkbox&id=b',
    );
    const page = makePageStub([a, b]);
    const result = detectChallenge(page);
    expect(result.has).toBe(true);
    if (result.has) expect(result.value.frame).toBe(a);
  });
});
