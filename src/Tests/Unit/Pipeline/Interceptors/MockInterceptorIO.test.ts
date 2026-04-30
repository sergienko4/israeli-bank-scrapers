/**
 * Unit tests for Interceptors/MockInterceptorIO — state + HTML resolution.
 */

import type { BrowserContext } from 'playwright-core';

import {
  getMockState,
  installMockContextRoute,
  resolveMockHtml,
} from '../../../../Scrapers/Pipeline/Interceptors/MockInterceptorIO.js';

describe('getMockState', () => {
  it('returns a fresh state for a new company id', () => {
    const state = getMockState('unit-test-bank-1');
    expect(state.currentPhase).toBe('init');
    expect(state.isRouted).toBe(false);
    expect(state.lastServed).toBe('');
  });

  it('returns the same singleton for the same company id', () => {
    const a = getMockState('unit-test-bank-2');
    const b = getMockState('unit-test-bank-2');
    expect(a).toBe(b);
  });

  it('returns distinct states for different company ids', () => {
    const a = getMockState('unit-test-bank-3');
    const b = getMockState('unit-test-bank-4');
    expect(a).not.toBe(b);
  });
});

describe('resolveMockHtml', () => {
  it('returns placeholder when no file and no lastHtml', () => {
    const html = resolveMockHtml('__nonexistent-bank-xxx__', 'phase-xyz', '');
    expect(html).toContain('__nonexistent-bank-xxx__');
    expect(html).toContain('phase-xyz');
  });

  it('returns lastHtml when provided and no file', () => {
    const html = resolveMockHtml('__nonexistent-bank-yyy__', 'phase-xyz', '<prev/>');
    expect(html).toBe('<prev/>');
  });

  it('returns file contents when snapshot exists on disk', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const now = Date.now();
    const companyId = `__resolve-test-bank-${String(now)}__`;
    const phase = 'home';
    const cwdResult1 = process.cwd();
    const dir = path.join(cwdResult1, 'tests/snapshots', companyId);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${phase}.html`);
    fs.writeFileSync(file, '<html>ondisk</html>', 'utf8');
    try {
      const html = resolveMockHtml(companyId, phase, '');
      expect(html).toContain('ondisk');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('installMockContextRoute', () => {
  const originalMockMode = process.env.MOCK_MODE;

  afterEach(() => {
    if (originalMockMode === undefined) delete process.env.MOCK_MODE;
    else process.env.MOCK_MODE = originalMockMode;
  });

  it('returns false when MOCK_MODE is unset', async () => {
    delete process.env.MOCK_MODE;
    const ctx = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      route: async (): Promise<void> => {
        await Promise.resolve();
      },
    } as unknown as BrowserContext;
    const didInstall = await installMockContextRoute(ctx, 'some-bank');
    expect(didInstall).toBe(false);
  });

  it('returns true when route is installed and MOCK_MODE is active', async () => {
    process.env.MOCK_MODE = '1';
    const routeCalls: number[] = [];
    const ctx = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      route: async (): Promise<void> => {
        await Promise.resolve();
        routeCalls.push(1);
      },
    } as unknown as BrowserContext;
    const didInstall = await installMockContextRoute(ctx, 'mock-test-bank-x');
    expect(didInstall).toBe(true);
    expect(routeCalls.length).toBe(1);
  });

  it('is idempotent (returns true without rerouting)', async () => {
    process.env.MOCK_MODE = '1';
    const routeCalls: number[] = [];
    const ctx = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      route: async (): Promise<void> => {
        await Promise.resolve();
        routeCalls.push(1);
      },
    } as unknown as BrowserContext;
    await installMockContextRoute(ctx, 'mock-test-bank-y');
    await installMockContextRoute(ctx, 'mock-test-bank-y');
    expect(routeCalls.length).toBe(1);
  });
});
