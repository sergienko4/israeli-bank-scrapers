/**
 * Unit tests for PreLoginPhaseActions — PRE/ACTION/POST/FINAL orchestration.
 */

import type { IRaceResult } from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import {
  executeFireRevealClicksSealed,
  executePreLocateReveal,
  executeSignalToLogin,
  executeValidateForm,
} from '../../../../Scrapers/Pipeline/Mediator/PreLogin/PreLoginPhaseActions.js';
import { some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IPreLoginDiscovery,
  IResolvedTarget,
} from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  makeMockContext,
  makeMockMediator,
} from '../../Scrapers/Pipeline/MockPipelineFactories.js';
import { makeMockActionExecutor, toActionCtx } from './TestHelpers.js';

/** Found race result. */
const FOUND: IRaceResult = {
  found: true,
  locator: false,
  candidate: { kind: 'textContent', value: 'Enter' },
  context: {} as unknown as IRaceResult['context'],
  index: 0,
  value: 'Enter',
  identity: false,
};

/** Mock reveal target. */
const MOCK_TARGET: IResolvedTarget = {
  selector: 'button',
  contextId: 'main',
  kind: 'textContent',
  candidateValue: 'Enter',
};

describe('executePreLocateReveal', () => {
  it('returns discovery with revealAction=NONE when form already visible', async () => {
    const mediator = makeMockMediator({
      /**
       * Always visible.
       * @returns Found result.
       */
      resolveVisible: () => Promise.resolve(FOUND),
    });
    const ctx = makeMockContext();
    const result = await executePreLocateReveal(mediator, ctx);
    const isOkResult1 = isOk(result);
    expect(isOkResult1).toBe(true);
    if (isOk(result) && result.value.preLoginDiscovery.has) {
      expect(result.value.preLoginDiscovery.value.revealAction).toBe('NONE');
    }
  });

  it('returns revealAction=NONE when no reveal probes match anything', async () => {
    const mediator = makeMockMediator();
    const ctx = makeMockContext();
    const result = await executePreLocateReveal(mediator, ctx);
    const isOkResult2 = isOk(result);
    expect(isOkResult2).toBe(true);
    if (isOk(result) && result.value.preLoginDiscovery.has) {
      expect(result.value.preLoginDiscovery.value.revealAction).toBe('NONE');
    }
  });
});

describe('executeFireRevealClicksSealed', () => {
  it('succeeds when no discovery present', async () => {
    const makeMockActionExecutorResult4 = makeMockActionExecutor();
    const makeMockContextResult3 = makeMockContext();
    const ctx = toActionCtx(makeMockContextResult3, makeMockActionExecutorResult4);
    const result = await executeFireRevealClicksSealed(ctx);
    const isOkResult5 = isOk(result);
    expect(isOkResult5).toBe(true);
  });

  it('succeeds for revealAction=NONE', async () => {
    const disc: IPreLoginDiscovery = {
      privateCustomers: 'NOT_FOUND',
      credentialArea: 'NOT_FOUND',
      revealAction: 'NONE',
    };
    const base = makeMockContext({ preLoginDiscovery: some(disc) });
    const makeMockActionExecutorResult6 = makeMockActionExecutor();
    const ctx = toActionCtx(base, makeMockActionExecutorResult6);
    const result = await executeFireRevealClicksSealed(ctx);
    const isOkResult7 = isOk(result);
    expect(isOkResult7).toBe(true);
  });

  it('clicks the reveal target for revealAction=CLICK', async () => {
    const disc: IPreLoginDiscovery = {
      privateCustomers: 'READY',
      credentialArea: 'NOT_FOUND',
      revealAction: 'CLICK',
      revealTarget: MOCK_TARGET,
    };
    const base = makeMockContext({ preLoginDiscovery: some(disc) });
    const makeMockActionExecutorResult8 = makeMockActionExecutor();
    const ctx = toActionCtx(base, makeMockActionExecutorResult8);
    const result = await executeFireRevealClicksSealed(ctx);
    const isOkResult9 = isOk(result);
    expect(isOkResult9).toBe(true);
  });

  it('navigates when revealAction=NAVIGATE with target', async () => {
    const disc: IPreLoginDiscovery = {
      privateCustomers: 'NOT_FOUND',
      credentialArea: 'NOT_FOUND',
      revealAction: 'NAVIGATE',
      revealTarget: { ...MOCK_TARGET, selector: 'https://bank.example.com/login' },
    };
    const base = makeMockContext({ preLoginDiscovery: some(disc) });
    const makeMockActionExecutorResult10 = makeMockActionExecutor();
    const ctx = toActionCtx(base, makeMockActionExecutorResult10);
    const result = await executeFireRevealClicksSealed(ctx);
    const isOkResult11 = isOk(result);
    expect(isOkResult11).toBe(true);
  });
});

describe('executeValidateForm', () => {
  it('fails when form gate never resolves', async () => {
    const mediator = makeMockMediator();
    const ctx = makeMockContext();
    const result = await executeValidateForm(mediator, ctx);
    const isOkResult12 = isOk(result);
    expect(isOkResult12).toBe(false);
  });

  it('succeeds with loginAreaReady=true when gate passes', async () => {
    const mediator = makeMockMediator({
      /**
       * Visible form gate.
       * @returns Found.
       */
      resolveVisible: () => Promise.resolve(FOUND),
    });
    const ctx = makeMockContext();
    const result = await executeValidateForm(mediator, ctx);
    const isOkResult13 = isOk(result);
    expect(isOkResult13).toBe(true);
    if (isOk(result)) {
      expect(result.value.loginAreaReady).toBe(true);
    }
  });
});

describe('executeSignalToLogin', () => {
  it('fails when loginAreaReady is false', () => {
    const ctx = makeMockContext({ loginAreaReady: false });
    const result = executeSignalToLogin(ctx);
    const isOkResult14 = isOk(result);
    expect(isOkResult14).toBe(false);
  });

  it('succeeds when loginAreaReady is true', () => {
    const ctx = makeMockContext({ loginAreaReady: true });
    const result = executeSignalToLogin(ctx);
    const isOkResult15 = isOk(result);
    expect(isOkResult15).toBe(true);
  });
});

// ── Extended coverage for CLICK + NAVIGATE + legacy fireRevealClicks ─

describe('executeFireRevealClicksSealed — executor absent paths', () => {
  it('returns succeed when CLICK but no executor', async () => {
    const disc: IPreLoginDiscovery = {
      privateCustomers: 'READY',
      credentialArea: 'NOT_FOUND',
      revealAction: 'CLICK',
      revealTarget: MOCK_TARGET,
    };
    const base = makeMockContext({ preLoginDiscovery: some(disc) });
    const ctx = toActionCtx(base, false);
    const result = await executeFireRevealClicksSealed(ctx);
    const isOkResult16 = isOk(result);
    expect(isOkResult16).toBe(true);
  });

  it('returns succeed when NAVIGATE but no target', async () => {
    const disc: IPreLoginDiscovery = {
      privateCustomers: 'NOT_FOUND',
      credentialArea: 'NOT_FOUND',
      revealAction: 'NAVIGATE',
    };
    const base = makeMockContext({ preLoginDiscovery: some(disc) });
    const makeMockActionExecutorResult17 = makeMockActionExecutor();
    const ctx = toActionCtx(base, makeMockActionExecutorResult17);
    const result = await executeFireRevealClicksSealed(ctx);
    const isOkResult18 = isOk(result);
    expect(isOkResult18).toBe(true);
  });

  it('returns succeed for CLICK with no target', async () => {
    const disc: IPreLoginDiscovery = {
      privateCustomers: 'READY',
      credentialArea: 'NOT_FOUND',
      revealAction: 'CLICK',
    };
    const base = makeMockContext({ preLoginDiscovery: some(disc) });
    const makeMockActionExecutorResult19 = makeMockActionExecutor();
    const ctx = toActionCtx(base, makeMockActionExecutorResult19);
    const result = await executeFireRevealClicksSealed(ctx);
    const isOkResult20 = isOk(result);
    expect(isOkResult20).toBe(true);
  });
});

describe('executePreLocateReveal — reveal target found path', () => {
  it('runs with reveal-probe returning NOT_FOUND (no target path)', async () => {
    const mediator = makeMockMediator();
    const { makeContextWithBrowser } =
      await import('../../Scrapers/Pipeline/MockPipelineFactories.js');
    const { makeScreenshotPage } = await import('./TestHelpers.js');
    const makeScreenshotPageResult21 = makeScreenshotPage();
    const ctx = makeContextWithBrowser(makeScreenshotPageResult21);
    const result = await executePreLocateReveal(mediator, ctx);
    const isOkResult22 = isOk(result);
    expect(isOkResult22).toBe(true);
  });
});
