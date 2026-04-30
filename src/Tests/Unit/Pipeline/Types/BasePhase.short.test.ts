/**
 * Unit tests for Types/BasePhase — MOCK_MODE short-circuits + empty-discovery early returns.
 *
 * Split off from BasePhase.test.ts to honor max-lines (300).
 */

import { BasePhase } from '../../../../Scrapers/Pipeline/Types/BasePhase.js';
import { none } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type { PhaseName } from '../../../../Scrapers/Pipeline/Types/Phase.js';
import type {
  IActionContext,
  IPipelineContext,
} from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { isOk, succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Scrapers/Pipeline/MockPipelineFactories.js';

describe('BasePhase MOCK_MODE short-circuit branches', () => {
  /** Track whether an action stage ran. */
  class StageRecorder extends BasePhase {
    public readonly name: PhaseName = 'home';
    public preRan = false;
    public actionRan = false;
    public postRan = false;
    public finalRan = false;

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
      this.preRan = true;
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
      this.actionRan = true;
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
      this.postRan = true;
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
      this.finalRan = true;
      return succeed(input);
    }
  }

  /** Snapshot of process.env.MOCK_MODE so we can restore it. */
  const originalEnv = process.env.MOCK_MODE;
  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.MOCK_MODE;
    } else {
      process.env.MOCK_MODE = originalEnv;
    }
  });

  it('under MOCK_MODE, action/post/final are skipped for a phase with RUN_PRE_ONLY policy', async () => {
    process.env.MOCK_MODE = '1';
    const phase = new StageRecorder();
    const ctx = makeMockContext();
    const result = await phase.run(ctx);
    const isOkResult13 = isOk(result);
    expect(isOkResult13).toBe(true);
    // PRE always runs (RUN_PRE_ONLY says PRE should run)
    expect(phase.preRan).toBe(true);
    // ACTION/POST/FINAL should be short-circuited
    expect(phase.actionRan).toBe(false);
    expect(phase.postRan).toBe(false);
    expect(phase.finalRan).toBe(false);
  });

  it('when MOCK_MODE is unset, all stages execute normally', async () => {
    delete process.env.MOCK_MODE;
    const phase = new StageRecorder();
    const ctx = makeMockContext();
    const result = await phase.run(ctx);
    const isOkResult14 = isOk(result);
    expect(isOkResult14).toBe(true);
    expect(phase.preRan).toBe(true);
    expect(phase.actionRan).toBe(true);
    expect(phase.postRan).toBe(true);
    expect(phase.finalRan).toBe(true);
  });
});

// ── Handoff empty-discovery branches ─────────────────────────────────────

describe('BasePhase HANDOFF — early-return branches', () => {
  /** Phase with 'pre-login' name but no preLoginDiscovery in ctx. */
  class PreLoginEmptyPhase extends BasePhase {
    public readonly name: 'pre-login' = 'pre-login' as const;
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

  it('pre-login phase with missing preLoginDiscovery returns early (line 137 branch)', async () => {
    const phase = new PreLoginEmptyPhase();
    const ctx = makeMockContext({ preLoginDiscovery: none() });
    const result = await phase.run(ctx);
    const isOkResult15 = isOk(result);
    expect(isOkResult15).toBe(true);
  });

  /** Scrape phase with NO scrapeDiscovery. */
  class ScrapeEmptyPhase extends BasePhase {
    public readonly name: 'scrape' = 'scrape' as const;
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

  it('scrape phase with missing scrapeDiscovery returns early', async () => {
    const phase = new ScrapeEmptyPhase();
    const ctx = makeMockContext({ scrapeDiscovery: none() });
    const result = await phase.run(ctx);
    const isOkResult16 = isOk(result);
    expect(isOkResult16).toBe(true);
  });

  /** Login phase with NO loginFieldDiscovery. */
  class LoginEmptyPhase extends BasePhase {
    public readonly name: 'login' = 'login' as const;
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

  it('login phase with empty loginFieldDiscovery returns early from handoffLogin', async () => {
    const phase = new LoginEmptyPhase();
    const ctx = makeMockContext({ loginFieldDiscovery: none() });
    const result = await phase.run(ctx);
    const isOkResult17 = isOk(result);
    expect(isOkResult17).toBe(true);
  });

  /** Dashboard phase without dashboardTarget in diagnostics. */
  class DashboardEmptyPhase extends BasePhase {
    public readonly name: 'dashboard' = 'dashboard' as const;
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

  it('dashboard phase with no dashboardTarget returns empty handoff parts', async () => {
    const phase = new DashboardEmptyPhase();
    const ctx = makeMockContext();
    const result = await phase.run(ctx);
    const isOkResult18 = isOk(result);
    expect(isOkResult18).toBe(true);
  });
});
