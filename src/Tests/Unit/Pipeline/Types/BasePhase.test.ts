/**
 * Unit tests for Types/BasePhase — Template Method orchestration for phases.
 */

import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import { BasePhase } from '../../../../Scrapers/Pipeline/Types/BasePhase.js';
import { none, some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type { PhaseName } from '../../../../Scrapers/Pipeline/Types/Phase.js';
import type {
  IActionContext,
  IPipelineContext,
} from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, isOk, succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Scrapers/Pipeline/MockPipelineFactories.js';

/** Concrete BasePhase subclass that records lifecycle calls. */
class DummyPhase extends BasePhase {
  public readonly name: PhaseName = 'init';
  public preCalls = 0;
  public actionCalls = 0;
  public postCalls = 0;
  public finalCalls = 0;

  /**
   * Test helper.
   * @param _ctx - Parameter.
   * @param input - Parameter.
   * @returns Result.
   */
  public async pre(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    await Promise.resolve();
    this.preCalls += 1;
    return succeed(input);
  }

  /**
   * Test helper.
   * @param _ctx - Parameter.
   * @param input - Parameter.
   * @returns Result.
   */
  public async action(
    _ctx: IActionContext,
    input: IActionContext,
  ): Promise<Procedure<IActionContext>> {
    await Promise.resolve();
    this.actionCalls += 1;
    return succeed(input);
  }

  /**
   * Test helper.
   * @param _ctx - Parameter.
   * @param input - Parameter.
   * @returns Result.
   */
  public async post(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    await Promise.resolve();
    this.postCalls += 1;
    return succeed(input);
  }

  /**
   * Test helper.
   * @param _ctx - Parameter.
   * @param input - Parameter.
   * @returns Result.
   */
  public async final(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    await Promise.resolve();
    this.finalCalls += 1;
    return succeed(input);
  }
}

/** Phase whose PRE fails — verifies .run() short-circuits. */
class PreFailPhase extends BasePhase {
  public readonly name: PhaseName = 'init';
  public postCalled = false;

  /**
   * Test helper.
   * @returns Result.
   */
  public async pre(): Promise<Procedure<IPipelineContext>> {
    await Promise.resolve();
    return fail(ScraperErrorTypes.Generic, 'PRE broke');
  }

  /**
   * Test helper.
   * @param _ctx - Parameter.
   * @param input - Parameter.
   * @returns Result.
   */
  public async action(
    _ctx: IActionContext,
    input: IActionContext,
  ): Promise<Procedure<IActionContext>> {
    await Promise.resolve();
    return succeed(input);
  }

  /**
   * Test helper.
   * @param _ctx - Parameter.
   * @param input - Parameter.
   * @returns Result.
   */
  public async post(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    await Promise.resolve();
    this.postCalled = true;
    return succeed(input);
  }
}

/** Phase whose ACTION fails. */
class ActionFailPhase extends BasePhase {
  public readonly name: PhaseName = 'login';
  public postCalled = false;

  /**
   * Test helper.
   * @returns Result.
   */
  public async action(): Promise<Procedure<IActionContext>> {
    await Promise.resolve();
    return fail(ScraperErrorTypes.Generic, 'ACTION crashed');
  }

  /**
   * Test helper.
   * @param _ctx - Parameter.
   * @param input - Parameter.
   * @returns Result.
   */
  public async post(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    await Promise.resolve();
    this.postCalled = true;
    return succeed(input);
  }
}

/** Phase with failing POST. */
class PostFailPhase extends BasePhase {
  public readonly name: PhaseName = 'dashboard';
  public finalCalled = false;

  /**
   * Test helper.
   * @param _ctx - Parameter.
   * @param input - Parameter.
   * @returns Result.
   */
  public async action(
    _ctx: IActionContext,
    input: IActionContext,
  ): Promise<Procedure<IActionContext>> {
    await Promise.resolve();
    return succeed(input);
  }

  /**
   * Test helper.
   * @returns Result.
   */
  public async post(): Promise<Procedure<IPipelineContext>> {
    await Promise.resolve();
    return fail(ScraperErrorTypes.Generic, 'POST broke');
  }

  /**
   * Test helper.
   * @param _ctx - Parameter.
   * @param input - Parameter.
   * @returns Result.
   */
  public async final(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    await Promise.resolve();
    this.finalCalled = true;
    return succeed(input);
  }
}

/** Phase with failing validatePrePayload. */
class ContractPhase extends BasePhase {
  public readonly name: PhaseName = 'scrape';

  /**
   * Test helper.
   * @param _ctx - Parameter.
   * @param input - Parameter.
   * @returns Result.
   */
  public async action(
    _ctx: IActionContext,
    input: IActionContext,
  ): Promise<Procedure<IActionContext>> {
    await Promise.resolve();
    return succeed(input);
  }

  /**
   * Test helper.
   * @returns Result.
   */
  protected override validatePrePayload(): boolean {
    return false;
  }
}

describe('BasePhase.run()', () => {
  it('runs PRE → ACTION → POST → FINAL in order', async () => {
    const phase = new DummyPhase();
    const ctx = makeMockContext();
    const result = await phase.run(ctx);
    const isOkResult1 = isOk(result);
    expect(isOkResult1).toBe(true);
    expect(phase.preCalls).toBe(1);
    expect(phase.actionCalls).toBe(1);
    expect(phase.postCalls).toBe(1);
    expect(phase.finalCalls).toBe(1);
  });

  it('short-circuits on PRE fail (does not call POST)', async () => {
    const phase = new PreFailPhase();
    const ctx = makeMockContext();
    const result = await phase.run(ctx);
    const isOkResult2 = isOk(result);
    expect(isOkResult2).toBe(false);
    expect(phase.postCalled).toBe(false);
  });

  it('short-circuits on ACTION fail (does not call POST)', async () => {
    const phase = new ActionFailPhase();
    const ctx = makeMockContext();
    const result = await phase.run(ctx);
    const isOkResult3 = isOk(result);
    expect(isOkResult3).toBe(false);
    expect(phase.postCalled).toBe(false);
  });

  it('short-circuits on POST fail (does not call FINAL)', async () => {
    const phase = new PostFailPhase();
    const ctx = makeMockContext();
    const result = await phase.run(ctx);
    const isOkResult4 = isOk(result);
    expect(isOkResult4).toBe(false);
    expect(phase.finalCalled).toBe(false);
  });

  it('fails with STAGE_CONTRACT_VIOLATION when validatePrePayload returns false', async () => {
    const phase = new ContractPhase();
    const ctx = makeMockContext();
    const result = await phase.run(ctx);
    const isOkResult5 = isOk(result);
    expect(isOkResult5).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('STAGE_CONTRACT_VIOLATION');
    }
  });

  it('runs run() with mediator present (exercises buildActionContext sealed path)', async () => {
    const { makeMockMediator, makeMockBrowserState } =
      await import('../../Scrapers/Pipeline/MockPipelineFactories.js');
    const phase = new DummyPhase();
    const med = makeMockMediator();
    const br = makeMockBrowserState();
    const ctx = makeMockContext({ mediator: some(med), browser: some(br) });
    const result = await phase.run(ctx);
    const isOkResult6 = isOk(result);
    expect(isOkResult6).toBe(true);
  });

  it('runs run() with mediator but no browser (skips sealed executor extraction)', async () => {
    const { makeMockMediator } = await import('../../Scrapers/Pipeline/MockPipelineFactories.js');
    const phase = new DummyPhase();
    const med = makeMockMediator();
    const ctx = makeMockContext({ mediator: some(med), browser: none() });
    const result = await phase.run(ctx);
    const isOkResult7 = isOk(result);
    expect(isOkResult7).toBe(true);
  });
});

describe('BasePhase default lifecycle hooks', () => {
  /** Phase that relies on BasePhase's default pre/post/final (no-op). */
  class DefaultHooksPhase extends BasePhase {
    public readonly name: PhaseName = 'init';
    /**
     * Test helper.
     * @param _ctx - Parameter.
     * @param input - Parameter.
     * @returns Result.
     */
    public async action(
      _ctx: IActionContext,
      input: IActionContext,
    ): Promise<Procedure<IActionContext>> {
      await Promise.resolve();
      return succeed(input);
    }
  }

  it('default pre/post/final pass through unchanged', async () => {
    const phase = new DefaultHooksPhase();
    const ctx = makeMockContext();
    const result = await phase.run(ctx);
    const isOkResult8 = isOk(result);
    expect(isOkResult8).toBe(true);
  });
});
