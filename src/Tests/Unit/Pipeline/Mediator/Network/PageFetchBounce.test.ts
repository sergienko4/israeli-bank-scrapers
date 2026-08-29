/**
 * Wiring tests for the in-page fetch bounce guard.
 *
 * <p>`Bounce.test.ts` proves the classifier decides correctly. These tests prove
 * the decision is actually *reached* — that every in-page carrier collects the
 * content-type and redirect facts and consults the guard before its body reaches
 * the JSON parser. That wiring is the whole defect: the WAF heuristic already
 * fired for diagnostics and the result was discarded one line before the parser
 * threw `Unexpected token '<'`.
 *
 * <p>The regression guards matter as much as the new behaviour.
 * {@link ScraperErrorTypes.WafBlocked} is terminal — `ApiMediator.retry.ts`
 * refuses to retry it — so a rate-limit or maintenance response that carries a
 * real JSON envelope must keep flowing to the parser exactly as before.
 */

import type { Page } from 'playwright-core';

import { WafBlockError } from '../../../../../Scrapers/Base/Errors.js';
import type { PageFetchTuple } from '../../../../../Scrapers/Pipeline/Mediator/Network/Fetch/Bounce.js';
import {
  fetchGetWithinPage,
  fetchGetWithinPageWithHeaders,
  fetchPostWithinPage,
} from '../../../../../Scrapers/Pipeline/Mediator/Network/Fetch/index.js';

/** Target every carrier requests unless a test needs PII in the URL. */
const TARGET_URL = 'https://bank.example/api/x';

/** A WAF interstitial served with a success status — the defect's shape. */
const WAF_HTML = '<html><head><title>Just a moment...</title></head></html>';

/** Synthetic account digits that must never reach a log. */
const PII_ACCOUNT = '1234567890';

/** URL whose account-shaped path segment `redactUrlFull` masks. */
const PII_URL = `https://bank.example/api/accounts/${PII_ACCOUNT}`;

/** Last-4 hint `redactUrlFull` leaves in place of the account segment. */
const REDACTED_ACCOUNT_HINT = '***7890';

/** A bank login page — trips no WAF pattern, so only `redirected` classifies it. */
const LOGIN_HTML = '<html><body><form>Sign in</form></body></html>';

/** Nine-digit account the HTML redactor masks down to its last four. */
const PII_BODY_ACCOUNT = '123456789';

/** A login page that echoes the customer's own details back in the markup. */
const LOGIN_HTML_WITH_PII = `<html><body>Account ${PII_BODY_ACCOUNT}<input value="Israel Israeli"></body></html>`;

/**
 * A page whose evaluate yields a fixed evaluator tuple.
 *
 * The in-page body is not re-executed here; these tests target what the
 * *caller* does with the tuple, which is where the guard lives.
 * @param tuple - Evaluator result to hand back.
 * @returns Fake page.
 */
function makeTuplePage(tuple: PageFetchTuple): Page {
  /**
   * Return the scripted tuple regardless of input.
   * @returns The scripted evaluator result.
   */
  const evaluate = (): Promise<PageFetchTuple> => Promise.resolve(tuple);
  return { evaluate } as unknown as Page;
}

/** Every entry point that routes a response through the bounce guard. */
const CARRIERS = [
  {
    label: 'GET',
    /**
     * Issue a plain in-page GET.
     * @param page - Page under test.
     * @param url - URL to request.
     * @returns The parsed body.
     */
    run: async (page: Page, url: string = TARGET_URL): Promise<unknown> =>
      fetchGetWithinPage(page, url),
  },
  {
    label: 'GET with headers',
    /**
     * Issue an in-page GET carrying discovered headers.
     * @param page - Page under test.
     * @param url - URL to request.
     * @returns The parsed body.
     */
    run: async (page: Page, url: string = TARGET_URL): Promise<unknown> =>
      fetchGetWithinPageWithHeaders(page, url, { 'X-Discovered': 'v' }),
  },
  {
    label: 'POST',
    /**
     * Issue an in-page POST.
     * @param page - Page under test.
     * @param url - URL to request.
     * @returns The parsed body.
     */
    run: async (page: Page, url: string = TARGET_URL): Promise<unknown> =>
      fetchPostWithinPage(page, url, { data: {} }),
  },
] as const;

describe('in-page fetch — bounced responses raise a typed error', () => {
  it.each(CARRIERS)('$label reports a 200 WAF interstitial as a WAF block', async ({ run }) => {
    const page = makeTuplePage([WAF_HTML, 200, 'text/html', false, TARGET_URL]);
    const pending = run(page);
    await expect(pending).rejects.toBeInstanceOf(WafBlockError);
  });

  it.each(CARRIERS)('$label no longer reports it as a JSON parse error', async ({ run }) => {
    const page = makeTuplePage([WAF_HTML, 200, 'text/html', false, TARGET_URL]);
    const pending = run(page);
    await expect(pending).rejects.not.toThrow(/Unexpected token/);
  });

  it.each(CARRIERS)('$label names the status it was blocked on', async ({ run }) => {
    const page = makeTuplePage([WAF_HTML, 403, 'text/html', false, TARGET_URL]);
    const pending = run(page);
    await expect(pending).rejects.toThrow(/HTTP 403/);
  });

  it('reports an HTML login page reached through a redirect', async () => {
    const login = '<html><body><form>Sign in</form></body></html>';
    const page = makeTuplePage([login, 200, 'text/html', true, 'https://bank.example/login']);
    const pending = fetchGetWithinPage(page, TARGET_URL);
    await expect(pending).rejects.toBeInstanceOf(WafBlockError);
  });
});

describe('in-page fetch — answered responses still reach the parser', () => {
  it.each(CARRIERS)('$label parses a 200 JSON body unchanged', async ({ run }) => {
    const page = makeTuplePage(['{"ok":true}', 200, 'application/json', false, TARGET_URL]);
    const pending = run(page);
    await expect(pending).resolves.toEqual({ ok: true });
  });

  // WafBlocked is terminal. A rate-limit carrying a real envelope must stay on
  // the retryable path it uses today, so this is a regression guard.
  it.each(CARRIERS)('$label keeps a 429 carrying a JSON envelope retryable', async ({ run }) => {
    const page = makeTuplePage(['{"error":"slow down"}', 429, 'application/json', false, '']);
    const pending = run(page);
    await expect(pending).resolves.toEqual({ error: 'slow down' });
  });

  it.each(CARRIERS)('$label keeps a 503 carrying a JSON envelope retryable', async ({ run }) => {
    const page = makeTuplePage(['{"maintenance":true}', 503, 'application/json', false, '']);
    const pending = run(page);
    await expect(pending).resolves.toEqual({ maintenance: true });
  });

  it.each(CARRIERS)('$label still treats a no-content response as empty', async ({ run }) => {
    const page = makeTuplePage(['', 204, '', false, TARGET_URL]);
    const pending = run(page);
    await expect(pending).resolves.toEqual({});
  });

  // The trailing tuple slots were appended, so a narrower evaluator result must
  // behave exactly as it did before the guard existed.
  it.each(CARRIERS)('$label accepts a two-element evaluator tuple', async ({ run }) => {
    const page = makeTuplePage(['{"legacy":true}', 200]);
    const pending = run(page);
    await expect(pending).resolves.toEqual({ legacy: true });
  });
});

describe('in-page fetch — the caller keeps control of failure', () => {
  it('honours shouldIgnoreErrors on GET rather than throwing', async () => {
    const page = makeTuplePage([WAF_HTML, 200, 'text/html', false, TARGET_URL]);
    const pending = fetchGetWithinPage(page, TARGET_URL, true);
    await expect(pending).resolves.toBeDefined();
  });

  it('honours shouldIgnoreErrors on POST rather than throwing', async () => {
    const page = makeTuplePage([WAF_HTML, 200, 'text/html', false, TARGET_URL]);
    const opts = { data: {}, shouldIgnoreErrors: true };
    const pending = fetchPostWithinPage(page, TARGET_URL, opts);
    await expect(pending).resolves.toBeDefined();
  });
});

// A bank URL carries the account in its path, and the block error is written to
// the log that records the failure — so the redaction the success path already
// performs has to hold on this path too.
describe('in-page fetch — the block error carries no raw account number', () => {
  /**
   * Drive a carrier against a bounced response and hand back the typed error.
   * @param run - Carrier entry point.
   * @param url - URL to request.
   * @returns The error the caller would observe.
   */
  async function blockError(
    run: (page: Page, url?: string) => Promise<unknown>,
    url: string,
  ): Promise<WafBlockError> {
    const page = makeTuplePage([WAF_HTML, 200, 'text/html', false, url]);
    const pending = run(page, url);
    const settled = await pending.catch((error: unknown): unknown => error);
    expect(settled).toBeInstanceOf(WafBlockError);
    return settled as WafBlockError;
  }

  it.each(CARRIERS)('$label keeps the account out of the message', async ({ run }) => {
    const error = await blockError(run, PII_URL);
    expect(error.message).not.toContain(PII_ACCOUNT);
  });

  it.each(CARRIERS)('$label keeps the account out of the structured detail', async ({ run }) => {
    const error = await blockError(run, PII_URL);
    expect(error.details.pageUrl).not.toContain(PII_ACCOUNT);
  });

  // The URL is deliberately absent from the message and carried structurally,
  // so the detail is the only place the blocked request stays identifiable.
  it.each(CARRIERS)('$label still identifies the request it blocked', async ({ run }) => {
    const error = await blockError(run, PII_URL);
    expect(error.details.pageUrl).toContain(REDACTED_ACCOUNT_HINT);
  });

  it('keeps the response body off the message', async () => {
    const page = makeTuplePage([WAF_HTML, 200, 'text/html', false, TARGET_URL]);
    const pending = fetchGetWithinPage(page, TARGET_URL);
    await expect(pending).rejects.not.toThrow(/<html>/);
  });

  // `WafBlockError.apiBlock` only truncates the snippet at 200 chars. A login
  // page redirect echoes the customer back at us, so the body needs the same
  // redaction the URL already gets before it is stored on the error.
  it('redacts an account echoed in the captured response snippet', async () => {
    const page = makeTuplePage([LOGIN_HTML_WITH_PII, 200, 'text/html', true, TARGET_URL]);
    const pending = fetchGetWithinPage(page, TARGET_URL);
    const settled = await pending.catch((error: unknown): unknown => error);
    const snippet = (settled as WafBlockError).details.responseSnippet ?? '';
    expect(snippet).not.toContain(PII_BODY_ACCOUNT);
  });

  it('redacts a customer name echoed in a form value attribute', async () => {
    const page = makeTuplePage([LOGIN_HTML_WITH_PII, 200, 'text/html', true, TARGET_URL]);
    const pending = fetchGetWithinPage(page, TARGET_URL);
    const settled = await pending.catch((error: unknown): unknown => error);
    const snippet = (settled as WafBlockError).details.responseSnippet ?? '';
    expect(snippet).not.toContain('Israel Israeli');
  });
});

/** What `Headers.get` returns for a header the response did not send. */
const ABSENT_HEADER = null as unknown as string;

/** Response fields the in-page evaluator must collect off a real `Response`. */
interface IStubResponse {
  readonly body: string;
  readonly status: number;
  readonly contentType: string;
  readonly isRedirected: boolean;
  readonly finalUrl: string;
}

/**
 * A page that executes the real in-page evaluator body instead of scripting it.
 * @returns Fake page whose evaluate invokes the serialised callback.
 */
function makeExecutingPage(): Page {
  /**
   * Invoke the in-page body directly.
   * @param fn - The serialised in-page callback.
   * @param args - Its single argument bundle.
   * @returns Whatever the in-page body returns.
   */
  const evaluate = (fn: (a: unknown) => unknown, args: unknown): unknown => fn(args);
  return { evaluate } as unknown as Page;
}

/**
 * Install a global fetch answering with a real `Response`-shaped object.
 * @param stub - Fields the response reports.
 * @returns Restore function.
 */
function installFetch(stub: IStubResponse): () => boolean {
  const scope = globalThis as unknown as { fetch?: unknown };
  const previous = scope.fetch;
  /**
   * Answer every request with the stubbed response.
   * @returns The Response-shaped stub.
   */
  const stubbed = (): Promise<unknown> => {
    const response = toResponseShape(stub);
    return Promise.resolve(response);
  };
  scope.fetch = stubbed;
  /**
   * Put the previous global fetch back.
   * @returns Always true, so the caller reads as a statement.
   */
  const restoreFetch = (): boolean => {
    scope.fetch = previous;
    return true;
  };
  return restoreFetch;
}

/**
 * Build the `Response` surface the in-page bodies read.
 * @param stub - Fields the response reports.
 * @returns Minimal Response-shaped object.
 */
function toResponseShape(stub: IStubResponse): unknown {
  /**
   * Report the stubbed content-type for any header name.
   * @returns The stubbed content-type, or the absent-header value when unset.
   */
  const get = (): string => (stub.contentType === '' ? ABSENT_HEADER : stub.contentType);
  /**
   * Body text accessor.
   * @returns The stubbed body.
   */
  const text = (): Promise<string> => Promise.resolve(stub.body);
  const headers = { get };
  return { status: stub.status, headers, redirected: stub.isRedirected, url: stub.finalUrl, text };
}

// makeTuplePage hands the guard a perfect tuple, so every test above would still
// pass if an evaluator stopped collecting one of the three appended fields.
// These drive the real evaluator and are shaped so that dropping a single field
// flips the outcome.
describe('in-page fetch — the evaluator collects the facts the guard needs', () => {
  /**
   * Undo whatever the running test installed. Reassigned per test; the initial
   * value keeps `afterEach` safe if an install ever throws.
   * @returns Always true, so the assignment reads as a value.
   */
  let restore: () => boolean = (): boolean => true;

  afterEach(() => {
    restore();
  });

  // The body is not JSON-prefixed and the WAF heuristic fires, so only the
  // collected content-type can keep this response on the parser path.
  it('collects the content-type, which outranks a WAF signal', async () => {
    restore = installFetch({
      body: WAF_HTML,
      status: 200,
      contentType: 'application/json',
      isRedirected: false,
      finalUrl: TARGET_URL,
    });
    const page = makeExecutingPage();
    const pending = fetchGetWithinPage(page, TARGET_URL);
    await expect(pending).rejects.not.toBeInstanceOf(WafBlockError);
  });

  // A plain login page trips no WAF pattern, so only the collected redirect
  // flag can classify this as a bounce.
  it('collects the redirect flag, which is the only signal for a login page', async () => {
    restore = installFetch({
      body: LOGIN_HTML,
      status: 200,
      contentType: 'text/html',
      isRedirected: true,
      finalUrl: 'https://bank.example/login',
    });
    const page = makeExecutingPage();
    const pending = fetchGetWithinPage(page, TARGET_URL);
    await expect(pending).rejects.toBeInstanceOf(WafBlockError);
  });

  it('collects the final URL, so the error names the redirect target', async () => {
    restore = installFetch({
      body: LOGIN_HTML,
      status: 200,
      contentType: 'text/html',
      isRedirected: true,
      finalUrl: 'https://bank.example/login',
    });
    const page = makeExecutingPage();
    const pending = fetchGetWithinPage(page, TARGET_URL);
    const settled = await pending.catch((error: unknown): unknown => error);
    expect((settled as WafBlockError).details.pageUrl).toContain('/login');
  });

  it('still parses a healthy JSON response through the real evaluator', async () => {
    restore = installFetch({
      body: '{"ok":true}',
      status: 200,
      contentType: 'application/json',
      isRedirected: false,
      finalUrl: TARGET_URL,
    });
    const page = makeExecutingPage();
    const pending = fetchGetWithinPage(page, TARGET_URL);
    await expect(pending).resolves.toEqual({ ok: true });
  });
});
