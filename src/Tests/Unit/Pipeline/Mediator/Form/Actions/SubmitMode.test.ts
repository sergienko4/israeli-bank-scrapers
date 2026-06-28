/**
 * Unit tests for D3 diagnostics:
 *   SubmitModeGate — PIPELINE_LOGIN_SUBMIT_MODE gate
 *   ActionsTypes  — logSubmitResult event field
 *   ActionsFill   — tryFormRequestSubmit wiring
 */

import type { Page } from 'playwright-core';

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

// ─── Per-call factory for tryFormRequestSubmit page/locator mocks ─────────────

/** Per-call spy capturing evaluate calls + the selector passed to locator(). */
interface IFormPageSpy {
  evaluateCalls: number;
  locatorArg: string;
}

/** Options driving one form-page mock's browser-side evaluate outcome. */
interface IFormPageOptions {
  /** Whether the matched element is submit-capable (requestSubmit present). */
  readonly isSubmitCapable?: boolean;
  /** When true, evaluate() rejects to exercise the catch path. */
  readonly shouldReject?: boolean;
}

/**
 * Build the browser-side evaluate stub for one form-page mock.
 * @param spy - Mutable spy updated on each evaluate call.
 * @param options - Submit-capability + error-path configuration.
 * @returns evaluate() resolving to the submit-capability boolean.
 */
function buildFormEvaluate(spy: IFormPageSpy, options: IFormPageOptions): () => Promise<boolean> {
  return (): Promise<boolean> => {
    spy.evaluateCalls += 1;
    if (options.shouldReject) return Promise.reject(new Error('element not attached'));
    return Promise.resolve(options.isSubmitCapable ?? true);
  };
}

/**
 * Build a Page mock whose locator(sel).evaluate() is driven by `options`.
 * Replaces the former module-level STUB_STATE with a per-call spy so locator
 * behaviour cannot drift between tests (prefer factories over shared state).
 * @param options - Submit-capability + error-path configuration.
 * @returns Page mock plus the spy for call-count / selector assertions.
 */
function makeFormPage(options: IFormPageOptions = {}): {
  readonly page: Page;
  readonly spy: IFormPageSpy;
} {
  const spy: IFormPageSpy = { evaluateCalls: 0, locatorArg: '' };
  const evaluate = buildFormEvaluate(spy, options);
  /**
   * Record the selector and return a locator exposing the evaluate stub.
   * @param sel - Selector passed to locator().
   * @returns Locator stub whose evaluate() is the configured form-evaluate.
   */
  const locator = (sel: string): { evaluate: typeof evaluate } => {
    spy.locatorArg = sel;
    return { evaluate };
  };
  return { page: { locator } as unknown as Page, spy };
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
  it('returns false when ctx is false — default enter-click is byte-identical', async () => {
    const didSubmit = await tryFormRequestSubmit(false, 'form#loginForm');
    expect(didSubmit).toBe(false);
  });

  it('returns false when formAnchor is empty — defensive guard fires', async () => {
    const { page, spy } = makeFormPage();
    const didSubmit = await tryFormRequestSubmit(page, '');
    expect(didSubmit).toBe(false);
    expect(spy.evaluateCalls).toBe(0);
  });

  it('calls locator(anchor).evaluate() and returns true on a submit-capable form', async () => {
    const { page, spy } = makeFormPage({ isSubmitCapable: true });
    const didSubmit = await tryFormRequestSubmit(page, 'form#loginForm');
    expect(didSubmit).toBe(true);
    expect(spy.locatorArg).toBe('form#loginForm');
    expect(spy.evaluateCalls).toBe(1);
  });

  it('propagates false when the element is not submit-capable (no synthetic success)', async () => {
    const { page, spy } = makeFormPage({ isSubmitCapable: false });
    const didSubmit = await tryFormRequestSubmit(page, 'div#notAForm');
    expect(didSubmit).toBe(false);
    expect(spy.evaluateCalls).toBe(1);
  });

  it('returns false without throwing when evaluate() rejects', async () => {
    const { page } = makeFormPage({ shouldReject: true });
    const didSubmit = await tryFormRequestSubmit(page, 'form');
    expect(didSubmit).toBe(false);
  });

  it('accepts a Frame as ctx (typed cast)', async () => {
    const { page, spy } = makeFormPage({ isSubmitCapable: true });
    const didSubmit = await tryFormRequestSubmit(page, 'form');
    expect(didSubmit).toBe(true);
    expect(spy.evaluateCalls).toBe(1);
  });
});
