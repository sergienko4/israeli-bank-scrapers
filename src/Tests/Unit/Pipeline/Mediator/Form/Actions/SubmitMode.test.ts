/**
 * Unit tests for D3 diagnostics:
 *   SubmitModeGate — PIPELINE_LOGIN_SUBMIT_MODE gate
 *   ActionsTypes  — logSubmitResult event field
 *   ActionsFill   — tryFormRequestSubmit wiring
 */

import type { Frame, Page } from 'playwright-core';

import { tryFormRequestSubmit } from '../../../../../../Scrapers/Pipeline/Mediator/Form/Actions/ActionsFill.js';
import { logSubmitResult } from '../../../../../../Scrapers/Pipeline/Mediator/Form/Actions/ActionsTypes.js';
import {
  readSubmitMode,
  SUBMIT_MODE_ENV_VAR,
} from '../../../../../../Scrapers/Pipeline/Mediator/Form/Actions/SubmitModeGate.js';
import type { ScraperLogger } from '../../../../../../Scrapers/Pipeline/Types/Debug.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Payload shape captured by the submit logger stub. */
interface ISubmitLog {
  readonly event: string;
  readonly method?: string;
  readonly url?: string;
}

/**
 * Build a logger stub that captures debug payloads for logSubmitResult tests.
 * @returns Logger and captured payloads array.
 */
function makeSubmitLogger(): { readonly logger: ScraperLogger; readonly logs: ISubmitLog[] } {
  const logs: ISubmitLog[] = [];
  /**
   * Capture one debug payload.
   * @param rec - Structured debug payload.
   * @returns True after storing.
   */
  const capture = (rec: ISubmitLog): true => {
    logs.push(rec);
    return true;
  };
  return { logger: { debug: capture } as unknown as ScraperLogger, logs };
}

/**
 * Return a fixed URL for the logSubmitResult source stub.
 * @returns Stub URL string.
 */
function getStubUrl(): string {
  return 'https://bank.example.co.il/login';
}

/** Minimal source stub providing getCurrentUrl for logSubmitResult tests. */
const STUB_SOURCE = { getCurrentUrl: getStubUrl };

// ─── Stub state for tryFormRequestSubmit tests ────────────────────────────────

/** Mutable call-tracking state for the locator stubs. Reset in beforeEach. */
interface IStubState {
  evaluateCallCount: number;
  locatorArg: string;
  shouldThrow: boolean;
}

/** Shared stub state — reset before each tryFormRequestSubmit test. */
const STUB_STATE: IStubState = { evaluateCallCount: 0, locatorArg: '', shouldThrow: false };

/**
 * Stub evaluate(): increments call count; rejects when shouldThrow is true.
 * @returns Promise resolving to true, or rejecting when shouldThrow is set.
 */
function stubEvaluate(): Promise<boolean> {
  STUB_STATE.evaluateCallCount++;
  if (STUB_STATE.shouldThrow) return Promise.reject(new Error('element not attached'));
  return Promise.resolve(true);
}

/**
 * Stub locator(): records selector arg and returns stub with stubEvaluate.
 * @param sel - Locator selector string.
 * @returns Stub locator object.
 */
function stubLocator(sel: string): { evaluate: typeof stubEvaluate } {
  STUB_STATE.locatorArg = sel;
  return { evaluate: stubEvaluate };
}

/**
 * Build a stub Page that routes locator() through stubLocator.
 * @returns Page stub.
 */
function makeStubPage(): Page {
  return { locator: stubLocator } as unknown as Page;
}

// ─── Tests: SubmitModeGate ────────────────────────────────────────────────────

describe('SubmitModeGate — readSubmitMode()', () => {
  let savedMode: string | undefined;

  beforeEach(() => {
    savedMode = process.env[SUBMIT_MODE_ENV_VAR];
  });

  afterEach(() => {
    if (savedMode === undefined) {
      delete process.env.PIPELINE_LOGIN_SUBMIT_MODE;
    } else {
      process.env[SUBMIT_MODE_ENV_VAR] = savedMode;
    }
  });

  it("returns 'enter-click' when env is unset", () => {
    delete process.env.PIPELINE_LOGIN_SUBMIT_MODE;
    const mode = readSubmitMode();
    expect(mode).toBe('enter-click');
  });

  it("returns 'enter-click' for an unknown value", () => {
    process.env[SUBMIT_MODE_ENV_VAR] = 'garbage-value';
    const mode = readSubmitMode();
    expect(mode).toBe('enter-click');
  });

  it("returns 'enter-click' for the explicit 'enter-click' value", () => {
    process.env[SUBMIT_MODE_ENV_VAR] = 'enter-click';
    const mode = readSubmitMode();
    expect(mode).toBe('enter-click');
  });

  it("returns 'form' for the 'form' value", () => {
    process.env[SUBMIT_MODE_ENV_VAR] = 'form';
    const mode = readSubmitMode();
    expect(mode).toBe('form');
  });

  it("returns 'all' for the 'all' value", () => {
    process.env[SUBMIT_MODE_ENV_VAR] = 'all';
    const mode = readSubmitMode();
    expect(mode).toBe('all');
  });
});

// ─── Tests: ActionsTypes ──────────────────────────────────────────────────────

describe("ActionsTypes — logSubmitResult emits event:'login.submit' (D3)", () => {
  it("adds event:'login.submit' to the debug record", () => {
    const { logger, logs } = makeSubmitLogger();
    logSubmitResult(logger, STUB_SOURCE, 'click');
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ event: 'login.submit', method: 'click' });
  });
});

// ─── Tests: ActionsFill — tryFormRequestSubmit ────────────────────────────────

describe('ActionsFill — tryFormRequestSubmit (D3 form.requestSubmit wiring)', () => {
  beforeEach(() => {
    STUB_STATE.evaluateCallCount = 0;
    STUB_STATE.locatorArg = '';
    STUB_STATE.shouldThrow = false;
  });

  it('returns false when ctx is false — default enter-click is byte-identical', async () => {
    const didSubmit = await tryFormRequestSubmit(false, 'form#loginForm');
    expect(didSubmit).toBe(false);
  });

  it('returns false when formAnchor is empty — defensive guard fires', async () => {
    const page = makeStubPage();
    const didSubmit = await tryFormRequestSubmit(page, '');
    expect(didSubmit).toBe(false);
    expect(STUB_STATE.evaluateCallCount).toBe(0);
  });

  it('calls locator(anchor).evaluate() and returns true on success', async () => {
    const page = makeStubPage();
    const didSubmit = await tryFormRequestSubmit(page, 'form#loginForm');
    expect(didSubmit).toBe(true);
    expect(STUB_STATE.locatorArg).toBe('form#loginForm');
    expect(STUB_STATE.evaluateCallCount).toBe(1);
  });

  it('returns false without throwing when evaluate() rejects', async () => {
    STUB_STATE.shouldThrow = true;
    const page = makeStubPage();
    const didSubmit = await tryFormRequestSubmit(page, 'form');
    expect(didSubmit).toBe(false);
  });

  it('accepts a Frame as ctx (typed cast)', async () => {
    const frameCtx = { locator: stubLocator } as unknown as Frame;
    const didSubmit = await tryFormRequestSubmit(frameCtx, 'form');
    expect(didSubmit).toBe(true);
    expect(STUB_STATE.evaluateCallCount).toBe(1);
  });
});
