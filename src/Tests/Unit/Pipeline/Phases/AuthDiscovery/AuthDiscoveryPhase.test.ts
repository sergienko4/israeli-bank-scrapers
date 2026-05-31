/**
 * Flow tests for the AUTH-DISCOVERY phase wrapper.
 *
 * The phase delegates each of its four hooks (pre / action / post /
 * final) to a sibling executor in {@link
 * "../../Mediator/AuthDiscovery/AuthDiscoveryActions.js"} — most of the
 * real probe code lives there. This test pins the wrapper behaviour
 * against the no-mediator path (the default mock context), which is
 * the configuration every CI-side smoke test runs in: each delegate
 * short-circuits via `if (!input.mediator.has) return succeed(input)`,
 * so the phase passes through cleanly without polluting `ctx`.
 *
 * Per test-guidlines.md "integration test over unit test", we exercise
 * the public `pre/action/post/final` API of the phase rather than
 * poking the action functions in isolation.
 */

import { createAuthDiscoveryPhase } from '../../../../../Scrapers/Pipeline/Phases/AuthDiscovery/AuthDiscoveryPhase.js';
import type {
  IActionContext,
  IPipelineContext,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { assertOk } from '../../../../Helpers/AssertProcedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';

describe('createAuthDiscoveryPhase ApiAuthDiscovery wrapper', () => {
  it('AD-PRE-1 pre delegates to executeAuthDiscoveryPre and short-circuits with no mediator', async () => {
    const phase = createAuthDiscoveryPhase();
    const ctx = makeMockContext();
    const result = await phase.pre(ctx, ctx);
    assertOk(result);
  });

  it('AD-ACTION-1 action returns the sealed pass-through unchanged', async () => {
    const phase = createAuthDiscoveryPhase();
    const ctx = makeMockContext();
    const actionCtx = ctx as unknown as IActionContext;
    const result = await phase.action(actionCtx, actionCtx);
    assertOk(result);
  });

  it('AD-POST-1 post delegates to executeAuthDiscoveryPost and short-circuits with no mediator', async () => {
    const phase = createAuthDiscoveryPhase();
    const ctx: IPipelineContext = makeMockContext();
    const result = await phase.post(ctx, ctx);
    assertOk(result);
    // Without a mediator the post hook is a pure pass-through —
    // authDiscovery stays absent.
    expect(result.value.authDiscovery.has).toBe(false);
  });

  it('AD-FINAL-1 final delegates to executeAuthDiscoveryFinal and short-circuits with no mediator', async () => {
    const phase = createAuthDiscoveryPhase();
    const ctx: IPipelineContext = makeMockContext();
    const result = await phase.final(ctx, ctx);
    assertOk(result);
  });

  it('AD-NAME-1 carries the canonical "auth-discovery" phase name', () => {
    const phase = createAuthDiscoveryPhase();
    expect(phase.name).toBe('auth-discovery');
  });
});
