/**
 * ElementIdentity tests — the token must identify an element, not a selector.
 *
 * <p>`elementPathToken` runs in the browser realm, so it is exercised here
 * against a plain DOM built with jsdom: the walk is pure DOM API and behaves
 * identically wherever it runs. `readElementIdentity` is exercised against
 * locator stubs, since its whole contract is what it does when the read
 * succeeds, returns nothing, or fails outright.
 *
 * @jest-environment jsdom
 */

import type { Frame, Page } from 'playwright-core';

import {
  elementPathToken,
  readElementIdentity,
  UNKNOWN_IDENTITY,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementIdentity.js';

/** A form with two password inputs — the shared-selector case. */
const FORM_HTML = `
  <form>
    <input id="user" placeholder="user" />
    <input id="pass" type="password" />
    <input id="confirm" type="password" />
  </form>
`;

/**
 * Look up an element by id in the current document.
 * @param id - Element id.
 * @returns The element, or a detached stand-in when the fixture is missing.
 */
function byId(id: string): Element {
  const found = document.getElementById(id);
  return found ?? document.createElement('input');
}

/**
 * Build a locator stub whose evaluate follows a scripted outcome.
 * @param outcome - Promise the evaluate should return.
 * @returns Locator stub exposing `first` and `evaluate`.
 */
function makeLocatorStub(outcome: () => Promise<string>): unknown {
  const locator = {
    /**
     * Narrow to the first match.
     * @returns The same locator stub.
     */
    first: (): unknown => locator,
    /**
     * Run the scripted outcome instead of visiting a real page.
     * @returns The scripted promise.
     */
    evaluate: outcome,
  };
  return locator;
}

/**
 * Wrap a locator stub in a context that always hands it back.
 * @param locator - Locator stub to serve.
 * @returns Page stub exposing only `locator`.
 */
function makeContext(locator: unknown): Page | Frame {
  const context = {
    /**
     * Serve the prepared locator regardless of the selector.
     * @returns The prepared locator stub.
     */
    locator: (): unknown => locator,
  };
  return context as unknown as Page;
}

/**
 * Build a context whose identity read resolves with a fixed token.
 * @param token - Token the in-page evaluate should report.
 * @returns Page stub that reports the token.
 */
function makeTokenContext(token: string): Page | Frame {
  /**
   * Report the scripted token.
   * @returns Resolved promise carrying the token.
   */
  const resolve = (): Promise<string> => Promise.resolve(token);
  const locator = makeLocatorStub(resolve);
  return makeContext(locator);
}

/**
 * Build a context whose identity read rejects.
 * @returns Page stub whose read always fails.
 */
function makeFailingContext(): Page | Frame {
  const detached = new Error('element is not attached');
  /**
   * Fail the way a detached element would.
   * @returns Rejected promise.
   */
  const reject = (): Promise<string> => Promise.reject(detached);
  const locator = makeLocatorStub(reject);
  return makeContext(locator);
}

/**
 * Attach a host whose shadow tree holds a form wrapping one input.
 *
 * <p>The input is nested one level down on purpose: an input placed directly
 * under the shadow root has no `parentElement` at all, so the interesting case
 * — a non-empty path that two separate components can both answer — only
 * appears once there is an element between the input and the boundary.
 * @param id - Host element id, so the two hosts are distinguishable.
 * @returns The input living inside the host's shadow tree.
 */
function makeShadowInput(id: string): Element {
  const host = document.createElement('div');
  host.id = id;
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const form = document.createElement('form');
  const input = document.createElement('input');
  form.appendChild(input);
  shadow.appendChild(form);
  return input;
}

describe('elementPathToken', () => {
  beforeEach(() => {
    document.body.innerHTML = FORM_HTML;
  });

  it('gives two elements sharing a selector different tokens', () => {
    const passEl = byId('pass');
    const confirmEl = byId('confirm');
    const pass = elementPathToken(passEl);
    const confirm = elementPathToken(confirmEl);
    expect(pass).not.toBe(confirm);
  });

  it('gives one element the same token however it was reached', () => {
    const element = byId('user');
    const first = elementPathToken(element);
    const second = elementPathToken(element);
    expect(first).toBe(second);
  });

  it('roots the token below the document element', () => {
    const element = byId('user');
    const token = elementPathToken(element);
    const isRooted = token.startsWith('BODY:');
    expect(isRooted).toBe(true);
  });

  it('reports an unknown token for a detached element', () => {
    const orphan = document.createElement('input');
    const token = elementPathToken(orphan);
    expect(token).toBe(UNKNOWN_IDENTITY);
  });

  it('changes the token when a sibling is inserted before the element', () => {
    const confirmEl = byId('confirm');
    const before = elementPathToken(confirmEl);
    const form = confirmEl.parentElement;
    const extra = document.createElement('input');
    const passEl = byId('pass');
    form?.insertBefore(extra, passEl);
    const after = elementPathToken(confirmEl);
    expect(after).not.toBe(before);
  });

  it('separates equally placed inputs in two shadow trees', () => {
    const firstEl = makeShadowInput('first-host');
    const secondEl = makeShadowInput('second-host');
    const first = elementPathToken(firstEl);
    const second = elementPathToken(secondEl);
    expect(first).not.toBe(second);
  });

  it('roots a shadow token in the document, not in its shadow tree', () => {
    const shadowEl = makeShadowInput('lone-host');
    const token = elementPathToken(shadowEl);
    const isRooted = token.startsWith('BODY:');
    expect(isRooted).toBe(true);
  });
});

describe('readElementIdentity', () => {
  it('returns the token the page reported', async () => {
    const context = makeTokenContext('BODY:1/FORM:0/INPUT:2');
    const identity = await readElementIdentity(context, '#pass');
    expect(identity).toBe('BODY:1/FORM:0/INPUT:2');
  });

  it('passes an empty token through as unknown identity', async () => {
    const context = makeTokenContext('');
    const identity = await readElementIdentity(context, '#pass');
    expect(identity).toBe(UNKNOWN_IDENTITY);
  });

  it('reports unknown when the read fails instead of propagating', async () => {
    const context = makeFailingContext();
    const identity = await readElementIdentity(context, '#pass');
    expect(identity).toBe(UNKNOWN_IDENTITY);
  });
});
