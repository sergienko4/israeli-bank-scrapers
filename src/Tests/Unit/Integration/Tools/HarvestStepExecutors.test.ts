/**
 * Unit tests for HarvestStepExecutors — per-kind dispatch + stubs.
 */

import type { Page } from 'playwright-core';

import type { ILoginConfig } from '../../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
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
  type SnapshotWriter,
} from '../../../Integration/Tools/HarvestStepExecutors.js';
import type {
  ICapturedResponse,
  IDisposeStatus,
  IDrainStatus,
  IResponseBufferHandle,
} from '../../../Integration/Tools/NetworkResponseRecorder.js';
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
  readonly loginConfig?: ILoginConfig;
  readonly snapshotsTaken?: string[];
}

/** Locator-shaped stub returned by the page stub's getByText. */
interface ILocatorStub {
  readonly first: () => ILocatorStub;
  readonly click: () => Promise<void>;
  readonly waitFor: () => Promise<void>;
}

/** Mutable holder that lets first() return the fully-built locator stub. */
interface ILocatorSlot {
  current: ILocatorStub;
}

/** Page methods implemented by the unit-test stub. */
interface IPageStubFields {
  readonly goto: (url: string) => Promise<void>;
  readonly waitForLoadState: (state: string) => Promise<void>;
  readonly getByText: (text: string) => ILocatorStub;
  readonly waitForURL: () => Promise<void>;
}

/**
 * Build the initial empty page-call log.
 *
 * @returns Zero-value call log for all tracked page methods.
 */
function makeCallLog(): IPageCallLog {
  return { goto: [], waitForLoadState: [], getByText: [], waitForURL: 0, click: 0, waitFor: 0 };
}

/**
 * Build the locator first() callback.
 * @param slot - Mutable slot holding the fully-built locator stub.
 * @returns first() callback.
 */
function makeLocatorFirst(slot: ILocatorSlot): () => ILocatorStub {
  return (): ILocatorStub => slot.current;
}

/**
 * Build the locator click callback.
 * @param calls - Shared call log.
 * @returns Click callback.
 */
function makeLocatorClick(calls: IPageCallLog): () => Promise<void> {
  return (): Promise<void> => {
    calls.click += 1;
    return Promise.resolve();
  };
}

/**
 * Build the locator waitFor callback.
 * @param calls - Shared call log.
 * @returns waitFor callback.
 */
function makeLocatorWaitFor(calls: IPageCallLog): () => Promise<void> {
  return (): Promise<void> => {
    calls.waitFor += 1;
    return Promise.resolve();
  };
}

/**
 * Build the locator stub object with self-referencing `first()` support.
 *
 * @param calls - Shared call log where click + waitFor counts are recorded.
 * @returns ILocatorStub that records calls and chains through `first()`.
 */
function buildLocatorStubObj(calls: IPageCallLog): ILocatorStub {
  const slot = {} as ILocatorSlot;
  const first = makeLocatorFirst(slot);
  const click = makeLocatorClick(calls);
  const waitFor = makeLocatorWaitFor(calls);
  const stub: ILocatorStub = { first, click, waitFor };
  slot.current = stub;
  return stub;
}

/**
 * Build the goto callback.
 * @param calls - Shared call log.
 * @returns goto callback.
 */
function makeGotoCallback(calls: IPageCallLog): (url: string) => Promise<void> {
  return (url: string): Promise<void> => {
    calls.goto.push(url);
    return Promise.resolve();
  };
}

/**
 * Build the lifecycle wait callback.
 * @param calls - Shared call log.
 * @returns waitForLoadState callback.
 */
function makeLoadStateCallback(calls: IPageCallLog): (state: string) => Promise<void> {
  return (state: string): Promise<void> => {
    calls.waitForLoadState.push(state);
    return Promise.resolve();
  };
}

/**
 * Build the getByText callback.
 * @param calls - Shared call log.
 * @param locatorStub - Locator returned by the callback.
 * @returns getByText callback.
 */
function makeGetByTextCallback(
  calls: IPageCallLog,
  locatorStub: ILocatorStub,
): (text: string) => ILocatorStub {
  return (text: string): ILocatorStub => {
    calls.getByText.push(text);
    return locatorStub;
  };
}

/**
 * Build the URL-wait callback.
 * @param calls - Shared call log.
 * @returns waitForURL callback.
 */
function makeWaitForUrlCallback(calls: IPageCallLog): () => Promise<void> {
  return (): Promise<void> => {
    calls.waitForURL += 1;
    return Promise.resolve();
  };
}

/**
 * Build the page stub fields backed by the shared call log.
 *
 * @param calls - Shared call log for all page method invocations.
 * @param locatorStub - The locator stub returned by `getByText`.
 * @returns Plain object with the harvester-used Page accessor methods.
 */
function buildPageStubObj(calls: IPageCallLog, locatorStub: ILocatorStub): IPageStubFields {
  const goto = makeGotoCallback(calls);
  const waitForLoadState = makeLoadStateCallback(calls);
  const getByText = makeGetByTextCallback(calls, locatorStub);
  const waitForURL = makeWaitForUrlCallback(calls);
  return { goto, waitForLoadState, getByText, waitForURL };
}

/**
 * Build a Playwright Page mock that records every harvester-used call.
 *
 * @returns Page-shaped mock plus a `calls` ledger.
 */
function makePageMock(): IPageMock {
  const calls = makeCallLog();
  const locatorStub = buildLocatorStubObj(calls);
  return { page: buildPageStubObj(calls, locatorStub) as unknown as Page, calls };
}

/**
 * Build the no-op buffer handle for tests that don't exercise network recording.
 *
 * @returns Buffer handle with no-op dispose + empty snapshot.
 */
function makeBufferDisposeCallback(): () => IDisposeStatus {
  return (): IDisposeStatus => ({ disposed: true as const });
}

/**
 * Build the no-op drain callback.
 * @returns Drain callback.
 */
function makeBufferDrainCallback(): () => Promise<IDrainStatus> {
  return (): Promise<IDrainStatus> =>
    Promise.resolve({ drained: true as const, pendingAtStart: 0 });
}

/**
 * Build the empty snapshot callback.
 * @returns Snapshot callback.
 */
function makeBufferSnapshotCallback(): () => readonly ICapturedResponse[] {
  return (): readonly ICapturedResponse[] => [];
}

/**
 * Build the no-op buffer handle for tests that don't exercise network recording.
 *
 * @returns Buffer handle with no-op dispose + empty snapshot.
 */
function buildBufferHandleStub(): IResponseBufferHandle {
  const dispose = makeBufferDisposeCallback();
  const drain = makeBufferDrainCallback();
  const snapshot = makeBufferSnapshotCallback();
  return { dispose, drain, snapshot };
}

/**
 * Build a fake buffer handle whose flushMatching is mocked at the executor boundary.
 * Snapshot is always empty — the recordResponse executor calls flushMatching, not snapshot.
 *
 * @returns Buffer handle with no-op dispose + empty snapshot.
 */
function makeBufferHandle(): IResponseBufferHandle {
  return buildBufferHandleStub();
}

/**
 * Build the snapshot recorder that captures step names into an array.
 *
 * @param taken - Array to record snapshot step names.
 * @returns Snapshot writer that appends step names without touching disk.
 */
function makeSnapshotRecorder(taken: string[]): SnapshotWriter {
  return (_page: Page, stepName: string): Promise<void> => {
    taken.push(stepName);
    return Promise.resolve();
  };
}

/**
 * Build an executor-args bundle with sensible defaults for tests.
 *
 * @param parts - Per-test overrides.
 * @returns Shared executor args struct.
 */
function makeExecArgs(parts: IExecArgsParts): IStepExecutorArgs {
  return {
    page: parts.page,
    outDir: '/tmp/test-fixtures',
    writeSnapshot: makeSnapshotRecorder(parts.snapshotsTaken ?? []),
    responseBuffer: parts.responseBuffer ?? makeBufferHandle(),
    credentials: parts.credentials,
    loginConfig: parts.loginConfig,
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

    it('returns skip result when credentials are present but no login config registered', async () => {
      const mock = makePageMock();
      const args = makeExecArgs({ page: mock.page, credentials: makeCredentials() });
      const step: ILoginStep = { kind: 'login', stepName: '04-login' };
      const result = await executeLoginStep(step, args);
      expect(result.snapshotWritten).toBe(false);
      expect(result.skipped).toMatch(/no login config registered/u);
    });
  });

  describe('executeHarvestStep dispatch', () => {
    it('routes goto steps to executeGotoStep', async () => {
      const mock = makePageMock();
      const args = makeExecArgs({ page: mock.page });
      const step: IGotoStep = { kind: 'goto', stepName: '01', url: 'https://x' };
      const result = await executeHarvestStep({ step, args });
      expect(result.kind).toBe('goto');
      expect(mock.calls.goto).toEqual(['https://x']);
    });

    it('routes login steps to executeLoginStep', async () => {
      const mock = makePageMock();
      const args = makeExecArgs({ page: mock.page });
      const step: ILoginStep = { kind: 'login', stepName: '04' };
      const result = await executeHarvestStep({ step, args });
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
