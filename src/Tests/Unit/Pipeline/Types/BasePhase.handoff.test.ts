/**
 * Unit tests for Types/BasePhase — HANDOFF log present-cases.
 *
 * Split off from BasePhase.test.ts to honor max-lines (300).
 */

import { BasePhase } from '../../../../Scrapers/Pipeline/Types/BasePhase.js';
import { none, some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type { PhaseName } from '../../../../Scrapers/Pipeline/Types/Phase.js';
import type {
  IActionContext,
  ILoginFieldDiscovery,
  IPreLoginDiscovery,
  IScrapeDiscovery,
} from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { isOk, succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Scrapers/Pipeline/MockPipelineFactories.js';

describe('BasePhase HANDOFF log (phase-scoped)', () => {
  /** Phase with preLogin name for HANDOFF routing. */
  class PreLoginLikePhase extends BasePhase {
    public readonly name: PhaseName = 'pre-login';
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

  it('handoff runs when preLoginDiscovery is present', async () => {
    const phase = new PreLoginLikePhase();
    const disc = { privateCustomers: 'READY', credentialArea: 'NOT_FOUND', revealAction: 'NONE' };
    const ctx = makeMockContext({ preLoginDiscovery: some(disc as unknown as IPreLoginDiscovery) });
    const result = await phase.run(ctx);
    const isOkResult9 = isOk(result);
    expect(isOkResult9).toBe(true);
  });

  /** Phase named scrape. */
  class ScrapeLikePhase extends BasePhase {
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
  }

  it('handoff runs when scrapeDiscovery present (scrape phase)', async () => {
    const phase = new ScrapeLikePhase();
    const disc = {
      qualifiedCards: ['A1'],
      prunedCards: [],
      txnTemplateUrl: '',
      txnTemplateBody: {},
      billingMonths: [],
    };
    const ctx = makeMockContext({ scrapeDiscovery: some(disc as unknown as IScrapeDiscovery) });
    const result = await phase.run(ctx);
    const isOkResult10 = isOk(result);
    expect(isOkResult10).toBe(true);
  });

  /** Phase named dashboard. */
  class DashboardLikePhase extends BasePhase {
    public readonly name: PhaseName = 'dashboard';
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

  it('handoff runs when dashboardTarget present (dashboard phase)', async () => {
    const phase = new DashboardLikePhase();
    const base = makeMockContext();
    const ctx = {
      ...base,
      diagnostics: {
        ...base.diagnostics,
        dashboardTarget: {
          selector: '#t',
          contextId: 'main',
          kind: 'css',
          candidateValue: '#t',
        },
      },
    };
    const result = await phase.run(ctx);
    const isOkResult11 = isOk(result);
    expect(isOkResult11).toBe(true);
  });

  /** Phase named login. */
  class LoginLikePhase extends BasePhase {
    public readonly name: PhaseName = 'login';
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

  it('handoff runs when loginFieldDiscovery present (login phase)', async () => {
    const phase = new LoginLikePhase();
    const disc = {
      targets: new Map([
        ['password', { selector: '#p', contextId: 'main', kind: 'css', candidateValue: 'pwd' }],
      ]),
      formAnchor: none(),
      activeFrameId: 'main',
      submitTarget: none(),
    };
    const ctx = makeMockContext({
      loginFieldDiscovery: some(disc as unknown as ILoginFieldDiscovery),
    });
    const result = await phase.run(ctx);
    const isOkResult12 = isOk(result);
    expect(isOkResult12).toBe(true);
  });
});
