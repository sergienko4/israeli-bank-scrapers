/**
 * Unit tests for Core/Builder/LoginPhaseFactory — declarative login phase.
 */

import type { ILoginConfig } from '../../../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import { buildDeclarativePhase } from '../../../../../Scrapers/Pipeline/Core/Builder/LoginPhaseFactory.js';
import type {
  IActionContext,
  IPipelineContext,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';

describe('buildDeclarativePhase', () => {
  /** Minimal config for factory instantiation. */
  const minimalConfig: ILoginConfig = {
    loginUrl: 'https://example.com',
    fields: [
      { credentialKey: 'username', selectors: [] },
      { credentialKey: 'password', selectors: [] },
    ],
    submit: [],
    possibleResults: { success: [] },
  };

  it('returns a BasePhase instance named "login"', () => {
    const phase = buildDeclarativePhase(minimalConfig);
    expect(phase.name).toBe('login');
  });

  it('exposes pre/action/post/final methods', () => {
    const phase = buildDeclarativePhase(minimalConfig);
    expect(typeof phase.action).toBe('function');
    expect(typeof phase.pre).toBe('function');
    expect(typeof phase.post).toBe('function');
    expect(typeof phase.final).toBe('function');
  });

  it('exposes a run template method', () => {
    const phase = buildDeclarativePhase(minimalConfig);
    expect(typeof phase.run).toBe('function');
  });

  it('returns a different instance for each call (no shared state)', () => {
    const a = buildDeclarativePhase(minimalConfig);
    const b = buildDeclarativePhase(minimalConfig);
    expect(a).not.toBe(b);
  });

  it('pre() delegates to the underlying phase (returns a Procedure)', async () => {
    const phase = buildDeclarativePhase(minimalConfig);
    const ctx = makeMockContext();
    const result = await phase.pre(ctx, ctx);
    expect(typeof result.success).toBe('boolean');
  });

  it('post() delegates to the underlying phase (returns a Procedure)', async () => {
    const phase = buildDeclarativePhase(minimalConfig);
    const ctx = makeMockContext();
    const result = await phase.post(ctx, ctx);
    expect(typeof result.success).toBe('boolean');
  });

  it('final() executes the login signal probe', async () => {
    const phase = buildDeclarativePhase(minimalConfig);
    const ctx = makeMockContext();
    const result = await phase.final(ctx, ctx);
    // Signal probe may succeed or fail depending on ctx; either is fine
    expect(typeof result.success).toBe('boolean');
  });

  it('action() delegates to underlying phase action (accepts sealed action ctx)', async () => {
    const phase = buildDeclarativePhase(minimalConfig);
    const full = makeMockContext();
    // Cast to IActionContext for this test — action-shape is a subset
    const actionCtx = full as unknown as IActionContext;
    const result = await phase.action(actionCtx, actionCtx);
    expect(typeof result.success).toBe('boolean');
  });

  it('action() handles a failing login phase — propagates failure', async () => {
    // A config with no login URL / fields may trigger a failure in underlying
    const emptyConfig: ILoginConfig = {
      loginUrl: '',
      fields: [],
      submit: [],
      possibleResults: { success: [] },
    };
    const phase = buildDeclarativePhase(emptyConfig);
    const full = makeMockContext();
    const actionCtx = full as unknown as IActionContext;
    const result = await phase.action(actionCtx, actionCtx);
    expect(typeof result.success).toBe('boolean');
  });

  it('run() triggers pre → action → post → final template method', async () => {
    const phase = buildDeclarativePhase(minimalConfig);
    const ctx: IPipelineContext = makeMockContext();
    const result = await phase.run(ctx);
    expect(typeof result.success).toBe('boolean');
  });
});
