/**
 * Bounce classification for in-page fetch responses.
 *
 * <p>Decides whether an unusable response body was a WAF/redirect bounce or an
 * ordinary parse failure. The distinction is load-bearing:
 * {@link ScraperErrorTypes.WafBlocked} is terminal — `ApiMediator.retry.ts`
 * refuses to retry it — so the 429/503-carrying-JSON cases below are regression
 * guards, not curiosities. Classifying a retryable origin rate-limit as a bounce
 * would permanently fail a run that recovers today.
 */

import { WafBlockError } from '../../../../../Scrapers/Base/Errors.js';
import type {
  BounceChecked,
  IResponseFacts,
} from '../../../../../Scrapers/Pipeline/Mediator/Network/Fetch/Bounce.js';
import {
  assertNotBounced,
  describeBounce,
} from '../../../../../Scrapers/Pipeline/Mediator/Network/Fetch/Bounce.js';

/**
 * Build response facts over a healthy-JSON-200 baseline.
 * @param over - Fields that differ from the healthy baseline.
 * @returns Response facts ready for classification.
 */
function facts(over: Partial<IResponseFacts>): IResponseFacts {
  const base = { text: '{"ok":true}', status: 200, url: 'https://bank.example/api/x' };
  return { ...base, contentType: 'application/json', ...over };
}

const CLOUDFLARE_HTML = '<html><head><title>Just a moment...</title></head></html>';
const LOGIN_HTML = '<html><body><form>Sign in</form></body></html>';

describe('describeBounce — flags a bounced response', () => {
  it('flags a WAF interstitial served under HTTP 200', () => {
    const bounced = facts({ text: CLOUDFLARE_HTML, contentType: 'text/html' });
    const reason = describeBounce(bounced);
    expect(reason).not.toBe('');
  });

  it('flags an HTML body served under a WAF status code', () => {
    const bounced = facts({ status: 429, text: '<html>blocked</html>', contentType: 'text/html' });
    const reason = describeBounce(bounced);
    expect(reason).not.toBe('');
  });

  it('flags an HTML login page reached through a redirect', () => {
    const bounced = facts({
      text: LOGIN_HTML,
      contentType: 'text/html',
      redirected: true,
      finalUrl: 'https://bank.example/login',
    });
    const reason = describeBounce(bounced);
    expect(reason).not.toBe('');
  });

  it('flags an HTML body even when the server sent no content-type', () => {
    const bounced = facts({ status: 503, text: '<html>maintenance</html>', contentType: '' });
    const reason = describeBounce(bounced);
    expect(reason).not.toBe('');
  });
});

describe('describeBounce — leaves a usable JSON body alone', () => {
  it('keeps a 429 carrying a JSON rate-limit envelope retryable', () => {
    const rateLimited = facts({ status: 429, text: '{"error":"rate_limited"}' });
    const reason = describeBounce(rateLimited);
    expect(reason).toBe('');
  });

  it('keeps a 503 carrying a JSON maintenance envelope retryable', () => {
    const maintenance = facts({ status: 503, text: '{"maintenance":true}' });
    const reason = describeBounce(maintenance);
    expect(reason).toBe('');
  });

  it('accepts a JSON array body when the server sent no content-type', () => {
    const arrayBody = facts({ text: '[1,2,3]', contentType: '' });
    const reason = describeBounce(arrayBody);
    expect(reason).toBe('');
  });

  it('accepts a JSON body that arrived through a redirect', () => {
    const viaRedirect = facts({ redirected: true });
    const reason = describeBounce(viaRedirect);
    expect(reason).toBe('');
  });

  it('accepts an ordinary JSON 200', () => {
    const healthy = facts({});
    const reason = describeBounce(healthy);
    expect(reason).toBe('');
  });

  it('accepts an empty body, which the parser turns into {}', () => {
    const noContent = facts({ text: '', status: 204, contentType: '' });
    const reason = describeBounce(noContent);
    expect(reason).toBe('');
  });

  // The gate answers one question: "would the parser have succeeded?" Prefix
  // sniffing only ever answered it for objects and arrays, but `JSON.parse`
  // also accepts the four primitive forms. A redirected endpoint replying
  // `true` as text/plain parses today, so condition 1 must stay false for it
  // or the redirect signal would turn a working call terminal.
  it.each([
    { form: 'numeric', text: '123' },
    { form: 'boolean', text: 'true' },
    { form: 'null', text: 'null' },
    { form: 'quoted-string', text: '"ok"' },
  ])('accepts a redirected $form primitive served as text/plain', ({ text }) => {
    const primitive = facts({ text, contentType: 'text/plain', redirected: true });
    const reason = describeBounce(primitive);
    expect(reason).toBe('');
  });

  // The mirror of the four above: a body that merely *starts* like JSON but
  // cannot parse must still be caught, or prefix sniffing has just been
  // swapped for a laxer version of itself.
  it('still flags a redirected body that opens with a brace but cannot parse', () => {
    const brokenJson = facts({ text: '{not json', contentType: 'text/plain', redirected: true });
    const reason = describeBounce(brokenJson);
    expect(reason).not.toBe('');
  });
});

describe('assertNotBounced', () => {
  const bounced = facts({ status: 429, text: CLOUDFLARE_HTML, contentType: 'text/html' });

  it('throws a WafBlockError for a bounced response', () => {
    expect((): BounceChecked => assertNotBounced(bounced, false)).toThrow(WafBlockError);
  });

  it('carries the HTTP status into the error details', () => {
    try {
      assertNotBounced(bounced, false);
      expect('no throw').toBe('WafBlockError');
    } catch (error) {
      expect((error as WafBlockError).details.httpStatus).toBe(429);
    }
  });

  it('names the detected signal in the error details', () => {
    try {
      assertNotBounced(bounced, false);
      expect('no throw').toBe('WafBlockError');
    } catch (error) {
      expect((error as WafBlockError).details.pageTitle).not.toBe('');
    }
  });

  it('reports the redirect target as the blocked URL', () => {
    const redirected = facts({
      text: LOGIN_HTML,
      contentType: 'text/html',
      redirected: true,
      finalUrl: 'https://bank.example/login',
    });
    try {
      assertNotBounced(redirected, false);
      expect('no throw').toBe('WafBlockError');
    } catch (error) {
      expect((error as WafBlockError).details.pageUrl).toContain('/login');
    }
  });

  it('stays silent when the caller asked to ignore errors', () => {
    const checked = assertNotBounced(bounced, true);
    expect(checked).toBe(true);
  });

  it('stays silent for a healthy JSON response', () => {
    const healthy = facts({});
    const checked = assertNotBounced(healthy, false);
    expect(checked).toBe(true);
  });
});
