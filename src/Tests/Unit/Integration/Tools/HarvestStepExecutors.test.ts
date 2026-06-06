/**
 * Unit tests for HarvestStepExecutors — per-kind dispatch + stubs.
 */

import type { Page } from 'playwright-core';

import { isSome, none, type Option, some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type { BankCredentials } from '../../../Integration/Tools/CredentialLoader.js';
import {
  executeGotoStep,
  executeHarvestStep,
  executeLoginStep,
  executeRecordResponseStep,
  executeRevealStep,
  executeSnapshotStep,
  executeWaitForStep,
  type IStepExecutorArgs,
} from '../../../Integration/Tools/HarvestStepExecutors.js';
import type { IResponseBufferHandle } from '../../../Integration/Tools/NetworkResponseRecorder.js';
import type {
  IGotoStep,
  ILoginStep,
  IRecordResponseStep,
  IRevealStep,
  ISnapshotStep,
  IWaitForStep,
} from '../../../Integration/Tools/RecipeStepTypes.js';

/** Records every method call dispatched against {@link IPageMock}. */
interface IPageCallLog {
  goto: string[];
  waitForLoadState: string[];
  getByText: string[];
  waitForURL: number;
  click: number;
  waitFor: number;
}

/** Mock Page exposed by {@link makePageMock} for executor assertions. */
interface IPageMock {
  readonly page: Page;
  readonly calls: IPageCallLog;
}

/** Arguments builder for {@link makeExecArgs}. */
interface IExecArgsParts {
  readonly page: Page;
  readonly responseBuffer?: IResponseBufferHandle;
  readonly credentials?: BankCredentials;
  readonly snapshotsTaken?: string[];
}

/** Locator-shaped stub returned by the page stub's getByText. */
interface ILocatorStub {
  readonly first: () => ILocatorStub;
  readonly click: () => Promise<void>;
  readonly waitFor: () => Promise<void>;
}

/**
 * Build a Playwright Page mock that records every harvester-used call.
 *
 * @returns Page-shaped mock plus a `calls` ledger.
 */
function makePageMock(): IPageMock {
  const calls: IPageCallLog = {
    goto: [],
    waitForLoadState: [],
    getByText: [],
    waitForURL: 0,
    click: 0,
    waitFor: 0,
  };
  const locatorStub: ILocatorStub = {
    /**
     * Return self — emulates the Playwright Locator builder chain.
     * @returns Same stub.
     */
    first: (): ILocatorStub => locatorStub,
    /**
     * Record one click and resolve.
     * @returns Resolved promise.
     */
    click: (): Promise<void> => {
      calls.click += 1;
      return Promise.resolve();
    },
    /**
     * Record one waitFor and resolve.
     * @returns Resolved promise.
     */
    waitFor: (): Promise<void> => {
      calls.waitFor += 1;
      return Promise.resolve();
    },
  };
  const stub = {
    /**
     * Record one goto navigation.
     * @param url - Target URL.
     * @returns Resolved promise.
     */
    goto: (url: string): Promise<void> => {
      calls.goto.push(url);
      return Promise.resolve();
    },
    /**
     * Record one lifecycle wait state.
     * @param state - Lifecycle event name.
     * @returns Resolved promise.
     */
    waitForLoadState: (state: string): Promise<void> => {
      calls.waitForLoadState.push(state);
      return Promise.resolve();
    },
    /**
     * Record a getByText invocation and return the locator stub.
     * @param text - Visible text query.
     * @returns Locator stub.
     */
    getByText: (text: string): ILocatorStub => {
      calls.getByText.push(text);
      return locatorStub;
    },
    /**
     * Record one URL-wait and resolve.
     * @returns Resolved promise.
     */
    waitForURL: (): Promise<void> => {
      calls.waitForURL += 1;
      return Promise.resolve();
    },
  };
  return { page: stub as unknown as Page, calls };
}

/**
 * Build a fake buffer handle whose flushMatching is mocked at the executor boundary.
 * Snapshot is always empty — the recordResponse executor calls flushMatching, not snapshot.
 *
 * @returns Buffer handle with no-op dispose + empty snapshot.
 */
function makeBufferHandle(): IResponseBufferHandle {
  return {
    /**
     * Return disposed status without side effects.
     * @returns Status object.
     */
    dispose: () => ({ disposed: true }),
    /**
     * No-op drain (tests do not exercise the in-flight race path).
     * @returns Resolved status with zero pending captures.
     */
    drain: () => Promise.resolve({ drained: true, pendingAtStart: 0 }),
    /**
     * Return an empty snapshot (no buffered responses).
     * @returns Empty array.
     */
    snapshot: () => [],
  };
}

/**
 * Build an executor-args bundle with sensible defaults for tests.
 *
 * @param parts - Per-test overrides.
 * @returns Shared executor args struct.
 */
function makeExecArgs(parts: IExecArgsParts): IStepExecutorArgs {
  const snapshotsTaken = parts.snapshotsTaken ?? [];
  /**
   * Snapshot writer that records each step name without touching disk.
   * @param _page - Unused page (test stub).
   * @param stepName - Step identifier the harvester would write.
   * @returns Resolved promise.
   */
  const writeSnapshot = (_page: Page, stepName: string): Promise<void> => {
    snapshotsTaken.push(stepName);
    return Promise.resolve();
  };
  return {
    page: parts.page,
    outDir: '/tmp/test-fixtures',
    writeSnapshot,
    responseBuffer: parts.responseBuffer ?? makeBufferHandle(),
    credentials: parts.credentials,
  };
}

/**
 * Build a sample bank credential struct for credential-aware tests.
 *
 * @returns Hapoalim-shaped credentials.
 */
function makeCredentials(): BankCredentials {
  return { userCode: 'u', password: 'p' };
}

describe('HarvestStepExecutors', () => {
  describe('executeGotoStep', () => {
    it('navigates, optional lifecycle wait, snapshot', async () => {
      const mock = makePageMock();
      const taken: string[] = [];
      const args = makeExecArgs({ page: mock.page, snapshotsTaken: taken });
      const step: IGotoStep = {
        kind: 'goto',
        stepName: '01-home',
        url: 'https://bank.example',
        waitFor: 'networkidle',
      };
      const result = await executeGotoStep(step, args);
      expect(result.snapshotWritten).toBe(true);
      expect(mock.calls.goto).toEqual(['https://bank.example']);
      expect(mock.calls.waitForLoadState).toEqual(['networkidle']);
      expect(taken).toEqual(['01-home']);
    });

    it('skips waitForLoadState when step.waitFor is undefined', async () => {
      const mock = makePageMock();
      const args = makeExecArgs({ page: mock.page });
      const step: IGotoStep = { kind: 'goto', stepName: '01', url: 'https://bank.example' };
      await executeGotoStep(step, args);
      expect(mock.calls.waitForLoadState).toEqual([]);
    });
  });

  describe('executeRevealStep', () => {
    it('clicks visible text + snapshots', async () => {
      const mock = makePageMock();
      const args = makeExecArgs({ page: mock.page });
      const step: IRevealStep = { kind: 'reveal', stepName: '02', revealText: 'כניסה' };
      const result = await executeRevealStep(step, args);
      expect(result.snapshotWritten).toBe(true);
      expect(mock.calls.getByText).toEqual(['כניסה']);
      expect(mock.calls.click).toBe(1);
    });
  });

  describe('executeSnapshotStep', () => {
    it('waits then snapshots when waitForLifecycle is set', async () => {
      const mock = makePageMock();
      const args = makeExecArgs({ page: mock.page });
      const step: ISnapshotStep = {
        kind: 'snapshot',
        stepName: '03',
        waitForLifecycle: 'networkidle',
      };
      await executeSnapshotStep(step, args);
      expect(mock.calls.waitForLoadState).toEqual(['networkidle']);
    });

    it('snapshots immediately when waitForLifecycle is unset', async () => {
      const mock = makePageMock();
      const args = makeExecArgs({ page: mock.page });
      const step: ISnapshotStep = { kind: 'snapshot', stepName: '03' };
      await executeSnapshotStep(step, args);
      expect(mock.calls.waitForLoadState).toEqual([]);
    });
  });

  describe('executeWaitForStep', () => {
    it('waits for URL substring', async () => {
      const mock = makePageMock();
      const args = makeExecArgs({ page: mock.page });
      const step: IWaitForStep = { kind: 'waitFor', stepName: '04', urlIncludes: '/dashboard' };
      await executeWaitForStep(step, args);
      expect(mock.calls.waitForURL).toBe(1);
    });

    it('waits for visible text', async () => {
      const mock = makePageMock();
      const args = makeExecArgs({ page: mock.page });
      const step: IWaitForStep = { kind: 'waitFor', stepName: '04', textVisible: 'יתרה' };
      await executeWaitForStep(step, args);
      expect(mock.calls.waitFor).toBe(1);
      expect(mock.calls.getByText).toEqual(['יתרה']);
    });
  });

  describe('executeRecordResponseStep', () => {
    it('marks skipped when buffer flush returns None (empty buffer)', async () => {
      const mock = makePageMock();
      const handle = makeBufferHandle();
      const args = makeExecArgs({ page: mock.page, responseBuffer: handle });
      const step: IRecordResponseStep = {
        kind: 'recordResponse',
        stepName: '05',
        urlPattern: '/never',
        captureAs: 'x',
      };
      const result = await executeRecordResponseStep(step, args);
      expect(result.snapshotWritten).toBe(true);
      expect(result.skipped).toMatch(/no buffered response matched/u);
    });
  });

  describe('executeLoginStep', () => {
    it('returns skip result when no credentials are loaded', async () => {
      const mock = makePageMock();
      const args = makeExecArgs({ page: mock.page });
      const step: ILoginStep = { kind: 'login', stepName: '04-login' };
      const result = await executeLoginStep(step, args);
      expect(result.snapshotWritten).toBe(false);
      expect(result.skipped).toMatch(/no credentials loaded/u);
    });

    it('throws ScraperError when credentials are present (PR-A2.2 marker)', async () => {
      const mock = makePageMock();
      const args = makeExecArgs({ page: mock.page, credentials: makeCredentials() });
      const step: ILoginStep = { kind: 'login', stepName: '04-login' };
      let caughtError: unknown;
      try {
        await executeLoginStep(step, args);
      } catch (err) {
        caughtError = err;
      }
      const errMsg = caughtError instanceof Error ? caughtError.message : '';
      expect(errMsg).toMatch(/PR-A2\.2/u);
    });
  });

  describe('executeHarvestStep dispatch', () => {
    it('routes goto steps to executeGotoStep', async () => {
      const mock = makePageMock();
      const args = makeExecArgs({ page: mock.page });
      const step: IGotoStep = { kind: 'goto', stepName: '01', url: 'https://x' };
      const result = await executeHarvestStep(step, args);
      expect(result.kind).toBe('goto');
      expect(mock.calls.goto).toEqual(['https://x']);
    });

    it('routes login steps to executeLoginStep', async () => {
      const mock = makePageMock();
      const args = makeExecArgs({ page: mock.page });
      const step: ILoginStep = { kind: 'login', stepName: '04' };
      const result = await executeHarvestStep(step, args);
      const skipReason: string = result.skipped ?? '';
      const hasSkipReason = skipReason.length > 0;
      expect(hasSkipReason).toBe(true);
    });
  });

  describe('Option API smoke check', () => {
    it('some(x).value matches x; none() has=false', () => {
      const present: Option<string> = some('hello');
      const absent: Option<string> = none();
      const hasPresent = isSome(present);
      const hasAbsent = isSome(absent);
      expect(hasPresent).toBe(true);
      expect(hasAbsent).toBe(false);
      const presentValue: string = hasPresent ? present.value : '';
      expect(presentValue).toBe('hello');
    });
  });
});
