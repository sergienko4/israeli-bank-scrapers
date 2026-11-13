/**
 * Ownership of the ambient log context while two pipeline executions overlap.
 *
 * <p>Each execution parks inside its action on an explicit barrier, so the
 * interleaving is fixed by the test and no assertion depends on timing or on
 * how many log lines were written. What is asserted is who owns `bank`,
 * `phase`, `stage` and `runId` at each observation point.
 *
 * <p>A sequential control proves the oracle reads those fields correctly, so a
 * failure under overlap can only be attributed to the overlap.
 */

import { CompanyTypes } from '../../../../Definitions.js';
import type { ScraperOptions } from '../../../../Scrapers/Base/Interface.js';
import { executePipeline } from '../../../../Scrapers/Pipeline/Core/Executor/PipelineExecutor.js';
import type { IPipelineDescriptor } from '../../../../Scrapers/Pipeline/Core/PipelineDescriptor.js';
import { getBankMixin } from '../../../../Scrapers/Pipeline/Logging/BankContext.js';
import { getRootLogger } from '../../../../Scrapers/Pipeline/Logging/RootLogger.js';
import { setActivePhase, setActiveStage } from '../../../../Scrapers/Pipeline/Types/ActiveState.js';
import type PhaseName from '../../../../Scrapers/Pipeline/Types/Phase.js';
import type {
  IActionContext,
  IPipelineContext,
} from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { resetTraceConfigCache } from '../../../../Scrapers/Pipeline/Types/TraceConfig.js';
import { SimplePhase } from './SimplePhase.js';

const CREDENTIALS = { username: 'user', password: 'pass' };

/** What the log context reported at one observation point. */
type Observation = Record<string, string>;

/** A one-shot barrier: `wait` parks until `open` is called. */
interface IGate {
  readonly wait: () => Promise<true>;
  readonly open: () => true;
}

/** The observations one execution made at its two points. */
interface ITrace {
  readonly before: Observation[];
  readonly after: Observation[];
}

/**
 * Placeholder released until the barrier is armed.
 * @returns True.
 */
function noop(): true {
  return true;
}

/**
 * Build a one-shot barrier.
 * @returns The barrier.
 */
function makeGate(): IGate {
  const release: { open: () => true } = { open: noop };
  const parked = new Promise<true>(resolve => {
    /**
     * Release everything parked on this barrier.
     * @returns True once released.
     */
    release.open = (): true => {
      resolve(true);
      return true;
    };
  });
  /**
   * Park until the barrier opens.
   * @returns Resolves once the barrier is open.
   */
  const wait = (): Promise<true> => parked;
  /**
   * Open the barrier.
   * @returns True once opened.
   */
  const open = (): true => release.open();
  return { wait, open };
}

/** The action shape a phase runs. */
type ActionFn = (ctx: IActionContext, input: IActionContext) => Promise<Procedure<IActionContext>>;

/** One run's observations and barriers. */
interface IRunProbe {
  readonly trace: ITrace;
  readonly entered: IGate;
  readonly resume: IGate;
}

/**
 * Descriptor for one bank with one phase.
 * @param companyId - Target bank.
 * @param phase - The phase to run.
 * @returns The descriptor.
 */
function descriptorFor(companyId: CompanyTypes, phase: SimplePhase): IPipelineDescriptor {
  const options = { companyId, startDate: new Date('2024-01-01') } as unknown as ScraperOptions;
  return { options, phases: [phase] };
}

/**
 * Observe the context, park on the run's barrier, then observe it again.
 * @param probe - The run's observations and barriers.
 * @returns True once the run has been released and has observed again.
 */
async function parkAndObserve(probe: IRunProbe): Promise<true> {
  const entering = getBankMixin();
  probe.trace.before.push(entering);
  probe.entered.open();
  await probe.resume.wait();
  const leaving = getBankMixin();
  probe.trace.after.push(leaving);
  return true;
}

/**
 * An action that parks and observes.
 * @param probe - The run's observations and barriers.
 * @returns The action.
 */
function observingAction(probe: IRunProbe): ActionFn {
  /**
   * Observe, park on the barrier, observe again.
   * @param _ctx - Unused.
   * @param input - The context to pass through.
   * @returns The context, unchanged.
   */
  const act: ActionFn = async (_ctx, input) => {
    await parkAndObserve(probe);
    return succeed(input);
  };
  return act;
}

/**
 * An action that does nothing, for a phase that parks in another stage.
 * @param _ctx - Unused.
 * @param input - The context to pass through.
 * @returns The context, unchanged.
 */
function passAction(
  _ctx: IActionContext,
  input: IActionContext,
): Promise<Procedure<IActionContext>> {
  const done = succeed(input);
  return Promise.resolve(done);
}

/** A phase that parks in POST rather than in ACTION. */
class PostParkedPhase extends SimplePhase {
  private readonly _probe: IRunProbe;

  /**
   * Create a phase that parks in POST.
   * @param probe - The run's observations and barriers.
   */
  constructor(probe: IRunProbe) {
    super('api-direct-call', passAction);
    this._probe = probe;
  }

  /**
   * POST — observe, park, observe again.
   * @param _ctx - Unused.
   * @param input - The context to pass through.
   * @returns The context, unchanged.
   */
  public override async post(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    await parkAndObserve(this._probe);
    return succeed(input);
  }
}

/**
 * A probe with nothing observed and both barriers closed.
 * @returns The probe.
 */
function makeProbe(): IRunProbe {
  return { trace: { before: [], after: [] }, entered: makeGate(), resume: makeGate() };
}

/** The bank and phase one overlapping run uses. */
interface IRunSpec {
  readonly bank: CompanyTypes;
  readonly phase: PhaseName;
}

/** A run that has started and is parked inside its action. */
interface IStartedRun {
  readonly probe: IRunProbe;
  readonly result: ReturnType<typeof executePipeline>;
}

/**
 * Start one run and wait until it is parked on its probe.
 * @param bank - Target bank.
 * @param phase - The phase that parks.
 * @param probe - The run's observations and barriers.
 * @returns The run's probe and its still-pending result.
 */
async function launch(
  bank: CompanyTypes,
  phase: SimplePhase,
  probe: IRunProbe,
): Promise<IStartedRun> {
  const descriptor = descriptorFor(bank, phase);
  const result = executePipeline(descriptor, CREDENTIALS);
  await probe.entered.wait();
  return { probe, result };
}

/**
 * Start one run and wait until it is parked inside its action.
 * @param spec - The run's bank and phase.
 * @returns The run's probe and its still-pending result.
 */
async function startParked(spec: IRunSpec): Promise<IStartedRun> {
  const probe = makeProbe();
  const phase = new SimplePhase(spec.phase, observingAction(probe));
  return launch(spec.bank, phase, probe);
}

/**
 * Overlap two runs: start A, start B, then release both.
 * @param specs - The two runs' banks and phases.
 * @returns Each run's probe, after both have finished.
 */
async function overlap(specs: readonly [IRunSpec, IRunSpec]): Promise<[IRunProbe, IRunProbe]> {
  const a = await startParked(specs[0]);
  const b = await startParked(specs[1]);
  a.probe.resume.open();
  b.probe.resume.open();
  await a.result;
  await b.result;
  return [a.probe, b.probe];
}

/**
 * Run one bank once to completion and return what it observed.
 * @param bank - Target bank.
 * @returns The run's probe.
 */
async function runOnce(bank: CompanyTypes): Promise<IRunProbe> {
  const probe = makeProbe();
  probe.resume.open();
  const phase = new SimplePhase('api-direct-call', observingAction(probe));
  const descriptor = descriptorFor(bank, phase);
  await executePipeline(descriptor, CREDENTIALS);
  return probe;
}

/**
 * Run one bank twice in a row, with no reset in between: the executor's own
 * uniqueness is what is under test, not a test-side reset.
 * @param bank - Target bank.
 * @returns Both runs' probes.
 */
async function runTwice(bank: CompanyTypes): Promise<[IRunProbe, IRunProbe]> {
  const first = await runOnce(bank);
  const second = await runOnce(bank);
  return [first, second];
}

/**
 * A phase that parks in ACTION on a probe.
 * @param probe - The run's observations and barriers.
 * @returns The phase.
 */
function actionPhase(probe: IRunProbe): SimplePhase {
  return new SimplePhase('api-direct-call', observingAction(probe));
}

const BEINLEUMI_CALL: IRunSpec = { bank: CompanyTypes.Beinleumi, phase: 'api-direct-call' };
const DISCOUNT_SCRAPE: IRunSpec = { bank: CompanyTypes.Discount, phase: 'api-direct-scrape' };
const DISCOUNT_CALL: IRunSpec = { bank: CompanyTypes.Discount, phase: 'api-direct-call' };

/**
 * Run a body with forensic trace forced off, restoring the variable afterwards.
 * @param body - The work to run.
 * @returns Whatever the body resolves to.
 */
async function withForensicOff<T>(body: () => Promise<T>): Promise<T> {
  const original = process.env.FORENSIC_TRACE;
  process.env.FORENSIC_TRACE = 'false';
  resetTraceConfigCache();
  try {
    return await body();
  } finally {
    if (original === undefined) delete process.env.FORENSIC_TRACE;
    else process.env.FORENSIC_TRACE = original;
  }
}

describe('PipelineExecutor — ownership of the log context under overlap', () => {
  afterEach(() => {
    resetTraceConfigCache();
    getRootLogger();
  });

  it('[ILV-0] a lone execution reads its own bank, phase and stage (control)', async () => {
    const probe = await runOnce(CompanyTypes.Beinleumi);
    const expected = { bank: 'beinleumi', phase: 'api-direct-call' };
    expect(probe.trace.before[0]).toMatchObject(expected);
    expect(probe.trace.after[0]).toMatchObject(expected);
  });

  it('[ILV-1] two overlapping executions each keep their own bank', async () => {
    const [a, b] = await overlap([BEINLEUMI_CALL, DISCOUNT_SCRAPE]);
    expect(a.trace.after[0].bank).toBe('beinleumi');
    expect(b.trace.after[0].bank).toBe('discount');
  });

  it('[ILV-2] two overlapping executions each keep their own phase', async () => {
    const [a, b] = await overlap([BEINLEUMI_CALL, DISCOUNT_SCRAPE]);
    expect(a.trace.after[0].phase).toBe('api-direct-call');
    expect(b.trace.after[0].phase).toBe('api-direct-scrape');
  });

  it('[ILV-3] two overlapping executions each keep their own runId', async () => {
    const [a, b] = await withForensicOff(() => overlap([BEINLEUMI_CALL, DISCOUNT_CALL]));
    expect(a.trace.before[0].runId).toBe(a.trace.after[0].runId);
    expect(b.trace.before[0].runId).toBe(b.trace.after[0].runId);
    expect(a.trace.after[0].runId).not.toBe(b.trace.after[0].runId);
  });

  it('[ILV-4] two sequential runs of the same bank each get their own runId', async () => {
    const [first, second] = await withForensicOff(() => runTwice(CompanyTypes.Beinleumi));
    expect(first.trace.after[0].runId).not.toBe('');
    expect(second.trace.after[0].runId).not.toBe(first.trace.after[0].runId);
  });

  it('[ILV-6] runs parked in different stages each keep their own stage', async () => {
    const inAction = makeProbe();
    const inPost = makeProbe();
    const parkedInAction = actionPhase(inAction);
    const a = await launch(CompanyTypes.Beinleumi, parkedInAction, inAction);
    const b = await launch(CompanyTypes.Discount, new PostParkedPhase(inPost), inPost);
    expect(a.probe.trace.before[0].stage).toBe('ACTION');
    expect(b.probe.trace.before[0].stage).toBe('POST');
    inAction.resume.open();
    await a.result;
    expect(a.probe.trace.after[0].stage).toBe('ACTION');
    inPost.resume.open();
    await b.result;
    expect(b.probe.trace.after[0].stage).toBe('POST');
  });

  it('[ILV-7] overlapping runs leave the outside stage and phase as they were', async () => {
    setActiveStage('PRE');
    setActivePhase('init');
    const outsideBefore = getBankMixin();
    await overlap([BEINLEUMI_CALL, DISCOUNT_SCRAPE]);
    const outsideAfter = getBankMixin();
    expect(outsideAfter).toEqual(outsideBefore);
  });

  it('[ILV-5] a run leaves no process-global bank behind', async () => {
    await runOnce(CompanyTypes.Beinleumi);
    const outside = getBankMixin();
    expect(outside.bank).toBeUndefined();
    expect(outside.runId).toBeUndefined();
  });
});
