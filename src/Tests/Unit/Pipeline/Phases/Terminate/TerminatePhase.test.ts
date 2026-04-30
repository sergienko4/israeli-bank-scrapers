/**
 * Unit tests for Phases/Terminate/TerminatePhase — factory + compat step.
 */

import {
  createTerminatePhase,
  TERMINATE_STEP,
  TerminatePhase,
} from '../../../../../Scrapers/Pipeline/Phases/Terminate/TerminatePhase.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';

describe('TerminatePhase', () => {
  it('has name "terminate"', () => {
    const phase = createTerminatePhase();
    expect(phase.name).toBe('terminate');
  });

  it('is an instance of TerminatePhase class', () => {
    const phase = createTerminatePhase();
    expect(phase).toBeInstanceOf(TerminatePhase);
  });

  it('creates distinct instances per call', () => {
    const a = createTerminatePhase();
    const b = createTerminatePhase();
    expect(a).not.toBe(b);
  });
});

describe('TERMINATE_STEP', () => {
  it('has name "terminate"', () => {
    expect(TERMINATE_STEP.name).toBe('terminate');
  });

  it('execute() returns succeed when no browser in context', async () => {
    const ctx = makeMockContext();
    const result = await TERMINATE_STEP.execute(ctx, ctx);
    const isOkResult1 = isOk(result);
    expect(isOkResult1).toBe(true);
  });
});

describe('TerminatePhase lifecycle', () => {
  it('pre() passes through', async () => {
    const phase = createTerminatePhase();
    const ctx = makeMockContext();
    const result = await phase.pre(ctx, ctx);
    const isOkResult2 = isOk(result);
    expect(isOkResult2).toBe(true);
  });

  it('action() always succeeds', async () => {
    const { toActionCtx } = await import('../../Infrastructure/TestHelpers.js');
    const phase = createTerminatePhase();
    const makeMockContextResult3 = makeMockContext();
    const ctx = toActionCtx(makeMockContextResult3, false);
    const result = await phase.action(ctx, ctx);
    const isOkResult4 = isOk(result);
    expect(isOkResult4).toBe(true);
  });

  it('post() stamps terminate-post', async () => {
    const phase = createTerminatePhase();
    const ctx = makeMockContext();
    const result = await phase.post(ctx, ctx);
    const isOkResult5 = isOk(result);
    expect(isOkResult5).toBe(true);
    if (isOk(result)) expect(result.value.diagnostics.lastAction).toBe('terminate-post');
  });

  it('final() stamps terminate-done', async () => {
    const phase = createTerminatePhase();
    const ctx = makeMockContext();
    const result = await phase.final(ctx, ctx);
    const isOkResult6 = isOk(result);
    expect(isOkResult6).toBe(true);
    if (isOk(result)) expect(result.value.diagnostics.lastAction).toBe('terminate-done');
  });
});
