import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';

import { jest } from '@jest/globals';
import pino from 'pino';

import { CompanyTypes } from '../../../../Definitions.js';
import type { ScraperOptions } from '../../../../Scrapers/Base/Interface.js';
import ScraperError from '../../../../Scrapers/Base/ScraperError.js';
import { executePipeline } from '../../../../Scrapers/Pipeline/Core/Executor/PipelineExecutor.js';
import type { IPipelineDescriptor } from '../../../../Scrapers/Pipeline/Core/PipelineDescriptor.js';
import { getBankMixin } from '../../../../Scrapers/Pipeline/Logging/BankContext.js';
import {
  buildSilentOptions,
  getRootLogger,
} from '../../../../Scrapers/Pipeline/Logging/RootLogger.js';
import type { IApiMediator } from '../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import { some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IActionContext,
  IPipelineContext,
} from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  getActiveRunId,
  getNetworkDumpDir,
  getRunFolder,
  getSubStepNetworkDumpDir,
  resetTraceConfigCache,
} from '../../../../Scrapers/Pipeline/Types/TraceConfig.js';
import { SimplePhase } from './SimplePhase.js';

/** Minimal synthetic credentials. */
const MOCK_CREDENTIALS = { username: 'user', password: 'pass' };

/** Portable OS-temp root wiped before each run so `pino/file` workers never hit ENOENT at teardown. */
const TMP_BASE = os.tmpdir();
const TWO_BANK_RUNS_ROOT = path.join(TMP_BASE, 'test-runs-executor-two-bank');

type ExecFn = (_ctx: IActionContext, _input: IActionContext) => Promise<Procedure<IActionContext>>;

interface IRunTraceSnapshot {
  readonly folder: string;
  readonly networkDir: string;
  readonly subStepDir: string;
  readonly runId: string;
  readonly mixin: Record<string, string>;
}

/**
 * Create a descriptor for `companyId` with the given phases.
 * @param companyId - Target bank enum member.
 * @param phases - Phases to execute.
 * @returns Pipeline descriptor.
 */
function makeBankDescriptor(
  companyId: CompanyTypes,
  phases: readonly SimplePhase[],
): IPipelineDescriptor {
  const options = { companyId, startDate: new Date('2024-01-01') } as unknown as ScraperOptions;
  return { options, phases: [...phases] };
}

/**
 * Build a stub IApiMediator whose dispose hook invokes `onDispose`.
 * @param onDispose - Observer invoked during executor cleanup.
 * @returns Stubbed IApiMediator.
 */
function makeDisposableMediator(onDispose: () => true): IApiMediator {
  /**
   * Invoke the caller's dispose observer and resolve.
   * @returns Resolved promise.
   */
  const dispose = (): Promise<void> => {
    onDispose();
    return Promise.resolve();
  };
  return { dispose } as unknown as IApiMediator;
}

/**
 * Execute one pipeline run for `companyId` and capture the ambient trace state
 * observed inside its active phase.
 * @param companyId - Target bank enum member.
 * @returns Captured trace snapshot.
 */
async function captureBankRunSnapshot(companyId: CompanyTypes): Promise<IRunTraceSnapshot> {
  const captured: { value: IRunTraceSnapshot | false } = { value: false };
  /**
   * Capture TraceConfig paths and log mixin inside the active phase.
   * @param _ctx - Action context (unused).
   * @param input - Pipeline context passed through.
   * @returns Success procedure with unchanged input.
   */
  const captureExecute: ExecFn = (_ctx, input) => {
    captured.value = {
      folder: getRunFolder(),
      networkDir: getNetworkDumpDir(),
      subStepDir: getSubStepNetworkDumpDir('api-direct-call', 'ACTION'),
      runId: getActiveRunId(),
      mixin: getBankMixin(),
    };
    const outcome = succeed(input);
    return Promise.resolve(outcome);
  };
  const phase = new SimplePhase('api-direct-call', captureExecute);
  const descriptor = makeBankDescriptor(companyId, [phase]);
  const result = await executePipeline(descriptor, MOCK_CREDENTIALS);
  expect(result.success).toBe(true);
  if (captured.value === false) {
    throw new ScraperError('Expected phase to capture trace snapshot');
  }
  return captured.value;
}

/** Phase test double that installs a custom `apiMediator` during `pre`. */
class MediatorInstallingPhase extends SimplePhase {
  private readonly _mediator: IApiMediator;

  /**
   * Construct a phase that attaches `mediator` in `pre`.
   * @param mediator - Stub mediator to install on `IPipelineContext`.
   * @param actionFn - Action step callback.
   */
  constructor(mediator: IApiMediator, actionFn: ExecFn) {
    super('api-direct-call', actionFn);
    this._mediator = mediator;
  }

  /**
   * Attach the stub mediator onto the unsealed pipeline context.
   * @param ctx - Incoming pipeline context.
   * @returns Success procedure carrying the custom `apiMediator`.
   */
  public override pre(ctx: IPipelineContext): Promise<Procedure<IPipelineContext>> {
    const apiMediator = some(this._mediator);
    const outcome = succeed({ ...ctx, apiMediator });
    return Promise.resolve(outcome);
  }
}

/**
 * Pass-through action step.
 * @param _ctx - Action context (unused).
 * @param input - Input context passed through.
 * @returns Success procedure with unchanged input.
 */
function passthroughAction(
  _ctx: IActionContext,
  input: IActionContext,
): Promise<Procedure<IActionContext>> {
  const outcome = succeed(input);
  return Promise.resolve(outcome);
}

describe('PipelineExecutor — ambient bank context & forensic trace isolation', () => {
  afterEach(() => {
    resetTraceConfigCache();
    getRootLogger();
  });

  it('enters runWithBankContext for phases and cleanup, spying on the pino mixin', async () => {
    const mixinSpy = jest.fn<Record<string, string>, []>(getBankMixin);
    const stream = new PassThrough();
    const pinoOpts = { ...buildSilentOptions(), level: 'info', mixin: mixinSpy };
    const logger = pino(pinoOpts, stream);
    const observedDispose: { bank: string | undefined } = { bank: undefined };
    /**
     * Record the ambient bank seen while the executor disposes the mediator.
     * @returns True once recorded.
     */
    const recordDisposeBank = (): true => {
      observedDispose.bank = getBankMixin().bank;
      return true;
    };
    /**
     * Emit a pino log inside the phase.
     * @param _ctx - Action context (unused).
     * @param input - Pipeline context passed through.
     * @returns Success procedure with unchanged input.
     */
    const observeExecute: ExecFn = (_ctx, input) => {
      logger.info({ msg: 'inside-phase' });
      const outcome = succeed(input);
      return Promise.resolve(outcome);
    };
    const stubMediator = makeDisposableMediator(recordDisposeBank);
    const phase1 = new MediatorInstallingPhase(stubMediator, observeExecute);
    const phase2 = new SimplePhase('api-direct-scrape', passthroughAction);
    expect(getBankMixin().bank).toBeUndefined();
    const descriptor = makeBankDescriptor(CompanyTypes.Beinleumi, [phase1, phase2]);
    const result = await executePipeline(descriptor, MOCK_CREDENTIALS);
    expect(result.success).toBe(true);
    expect(mixinSpy).toHaveBeenCalledTimes(1);
    expect(mixinSpy.mock.results[0]?.value).toMatchObject({ bank: 'beinleumi' });
    expect(observedDispose.bank).toBe('beinleumi');
    expect(getBankMixin().bank).toBeUndefined();
  });

  it('isolates run folders, runIds, and mixin bank across sequential two-bank runs under FORENSIC_TRACE=true', async () => {
    const originalForensic = process.env.FORENSIC_TRACE;
    const originalRunsRoot = process.env.RUNS_ROOT;
    fs.rmSync(TWO_BANK_RUNS_ROOT, { recursive: true, force: true });
    process.env.FORENSIC_TRACE = 'true';
    process.env.RUNS_ROOT = TWO_BANK_RUNS_ROOT;
    resetTraceConfigCache();
    try {
      const first = await captureBankRunSnapshot(CompanyTypes.Beinleumi);
      const second = await captureBankRunSnapshot(CompanyTypes.Discount);
      expect(first.folder).toContain(`${path.sep}beinleumi${path.sep}`);
      expect(second.folder).toContain(`${path.sep}discount${path.sep}`);
      expect(second.folder).not.toBe(first.folder);
      expect(second.networkDir).not.toBe(first.networkDir);
      expect(second.subStepDir).not.toBe(first.subStepDir);
      expect(first.runId).not.toBe('');
      expect(second.runId).not.toBe('');
      expect(second.runId).not.toBe(first.runId);
      expect(first.mixin.bank).toBe('beinleumi');
      expect(second.mixin.bank).toBe('discount');
      expect(first.mixin.runId).toBe(first.runId);
      expect(second.mixin.runId).toBe(second.runId);
    } finally {
      if (originalForensic === undefined) delete process.env.FORENSIC_TRACE;
      else process.env.FORENSIC_TRACE = originalForensic;
      if (originalRunsRoot === undefined) delete process.env.RUNS_ROOT;
      else process.env.RUNS_ROOT = originalRunsRoot;
      resetTraceConfigCache();
      getRootLogger();
    }
  });
});
