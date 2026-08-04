/**
 * Regression tests for the production v1.42.2 memory blow-up.
 *
 * <p>Navigation HTML documents were read in full via `response.text()` only to
 * fail `JSON.parse` and be stored as `null` — the whole page cost was paid and
 * the result discarded. These tests pin the resource-type gate that stops the
 * read, both at the predicate level and end-to-end through `handleResponse`.
 *
 * <p>`text/html` itself stays recordable on purpose: Leumi and Isracard serve
 * JSON under an HTML content type. Only the `document` resource type — a real
 * page navigation — is dropped.
 */

import type { Response } from 'playwright-core';

import { handleResponse } from '../../../../../Scrapers/Pipeline/Mediator/Network/Indexing/Indexing.js';
import {
  isPageDocumentHtml,
  shouldRecordResponse,
} from '../../../../../Scrapers/Pipeline/Mediator/Network/Indexing/ResponsePrimitives.js';
import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscoveryTypes.js';

/** Stub of the Playwright `Request` surface the capture path reads. */
class FakeRequest {
  /** Resource type reported to the capture gate. */
  public readonly type: string;

  /**
   * Create a stub request reporting a caller-chosen resource type.
   * @param type - Playwright resource type, e.g. `document` or `xhr`.
   */
  constructor(type: string) {
    this.type = type;
  }

  /**
   * Request headers — empty, the gate never reads them.
   * @returns An empty header bag.
   */
  public headers(): Record<string, string> {
    return {};
  }

  /**
   * Request method.
   * @returns The fixed `GET` verb.
   */
  public method(): string {
    return 'GET';
  }

  /**
   * Request body.
   * @returns An empty post body.
   */
  public postData(): string {
    return '';
  }

  /**
   * Playwright resource type driving the capture gate.
   * @returns The configured resource type.
   */
  public resourceType(): string {
    return this.type;
  }
}

/** Stub `Response` that counts every body read — the memory cost under test. */
class FakeResponse {
  /** How many times `text()` was called. Must stay 0 for page documents. */
  public textCalls = 0;

  /** Content type reported in the response headers. */
  public readonly contentType: string;

  /** HTTP status — fixed, the gate only special-cases 204. */
  public readonly statusCode = 200;

  /** Backing stub request. */
  public readonly req: FakeRequest;

  /**
   * Create a stub response for one content type / resource type pair.
   * @param contentType - Value of the `content-type` response header.
   * @param resourceType - Playwright resource type of the originating request.
   */
  constructor(contentType: string, resourceType: string) {
    this.contentType = contentType;
    this.req = new FakeRequest(resourceType);
  }

  /**
   * Response headers.
   * @returns A header bag carrying the configured content type.
   */
  public headers(): Record<string, string> {
    return { 'content-type': this.contentType };
  }

  /**
   * Originating request.
   * @returns The backing stub request.
   */
  public request(): FakeRequest {
    return this.req;
  }

  /**
   * HTTP status.
   * @returns The fixed 200 status.
   */
  public status(): number {
    return this.statusCode;
  }

  /**
   * Body read — the expensive call this fix exists to avoid.
   * @returns A page-sized HTML body.
   */
  public text(): Promise<string> {
    this.textCalls += 1;
    return Promise.resolve('<html lang="he"><body>dashboard</body></html>');
  }

  /**
   * Response URL.
   * @returns A stable dashboard URL.
   */
  public url(): string {
    return 'https://bank.example/dashboard';
  }
}

/**
 * Collection gate for `handleResponse` — always open.
 * @returns Always true.
 */
function alwaysActive(): boolean {
  return true;
}

/**
 * Drain the microtasks behind the fire-and-forget parse chain.
 * @returns Resolves once the parse chain has settled.
 */
async function flushParse(): Promise<boolean> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  return true;
}

/**
 * Feed one stub response through the real capture entry point.
 * @param response - Stub response to hand to `handleResponse`.
 * @returns Resolves once the parse chain has settled.
 */
async function capture(response: FakeResponse): Promise<boolean> {
  const captured: IDiscoveredEndpoint[] = [];
  handleResponse(captured, response as unknown as Response, alwaysActive);
  return flushParse();
}

describe('isPageDocumentHtml — HTML navigation bodies never reach response.text()', () => {
  it('T-MEM-1 — treats an HTML navigation body as a page document', () => {
    const isDocument = isPageDocumentHtml('text/html; charset=utf-8', 'document');
    expect(isDocument).toBe(true);
  });

  it('T-MEM-2 — spares HTML delivered over xhr (bank JSON-over-HTML APIs)', () => {
    const isDocument = isPageDocumentHtml('text/html; charset=utf-8', 'xhr');
    expect(isDocument).toBe(false);
  });

  it('T-MEM-3 — spares HTML delivered over fetch', () => {
    const isDocument = isPageDocumentHtml('text/html', 'fetch');
    expect(isDocument).toBe(false);
  });

  it('T-MEM-4 — ignores non-HTML content types entirely', () => {
    const isDocument = isPageDocumentHtml('application/json', 'document');
    expect(isDocument).toBe(false);
  });
});

describe('shouldRecordResponse — resourceType gate', () => {
  it('T-MEM-5 — drops an HTML page document', () => {
    const didRecord = shouldRecordResponse(200, 'text/html; charset=utf-8', 'document');
    expect(didRecord).toBe(false);
  });

  it('T-MEM-6 — keeps Leumi/Isracard JSON served as text/html over xhr', () => {
    const didRecord = shouldRecordResponse(200, 'text/html; charset=utf-8', 'xhr');
    expect(didRecord).toBe(true);
  });

  it('T-MEM-7 — still records 204 no-content regardless of resource type', () => {
    const didRecord = shouldRecordResponse(204, 'text/html', 'document');
    expect(didRecord).toBe(true);
  });

  it('T-MEM-8 — defaults to the API resource type when none is supplied', () => {
    const didRecord = shouldRecordResponse(200, 'text/html');
    expect(didRecord).toBe(true);
  });
});

describe('handleResponse — the body of a page document is never read', () => {
  it('T-MEM-9 — reads zero bytes from an HTML navigation response', async () => {
    const response = new FakeResponse('text/html; charset=utf-8', 'document');
    await capture(response);
    expect(response.textCalls).toBe(0);
  });

  it('T-MEM-10 — still reads HTML served over xhr, proving the spy fires', async () => {
    const response = new FakeResponse('text/html; charset=utf-8', 'xhr');
    await capture(response);
    expect(response.textCalls).toBe(1);
  });

  it('T-MEM-11 — still reads genuine JSON API responses', async () => {
    const response = new FakeResponse('application/json', 'xhr');
    await capture(response);
    expect(response.textCalls).toBe(1);
  });
});
