/**
 * Unit tests for Interceptors/PopupInterceptor — factory + per-phase gating.
 */

import { createPopupInterceptor } from '../../../../Scrapers/Pipeline/Interceptors/PopupInterceptor.js';
import { isOk } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../Infrastructure/MockFactories.js';

describe('createPopupInterceptor', () => {
  it('returns an interceptor with name "popup-dismiss"', () => {
    const inst = createPopupInterceptor();
    expect(inst.name).toBe('popup-dismiss');
  });

  it('exposes a beforePhase async function', () => {
    const inst = createPopupInterceptor();
    expect(typeof inst.beforePhase).toBe('function');
  });

  it('returns succeed when ctx has no mediator', async () => {
    const inst = createPopupInterceptor();
    const ctx = makeMockContext();
    const result = await inst.beforePhase(ctx, 'home');
    expect(result).toBeDefined();
    const isOkResult1 = isOk(result);
    expect(isOkResult1).toBe(true);
  });

  it('returns succeed when nextPhase is not in whitelist', async () => {
    const inst = createPopupInterceptor();
    const ctx = makeMockContext();
    const result = await inst.beforePhase(ctx, 'login');
    expect(result).toBeDefined();
    const isOkResult2 = isOk(result);
    expect(isOkResult2).toBe(true);
  });

  it('creates independent instances per call', () => {
    const a = createPopupInterceptor();
    const b = createPopupInterceptor();
    expect(a).not.toBe(b);
  });
});
