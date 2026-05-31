/**
 * Unit tests for TurnstileCheckboxSolver — shared-primitive delegation.
 */

import type { ElementHandle, Frame, Page } from 'playwright-core';

import { solveHCaptchaCheckbox } from '../../../../../Scrapers/Pipeline/Interceptors/WafChallenge/HCaptchaCheckboxSolver.js';
import solveTurnstileCheckboxDefault, {
  solveTurnstileCheckbox,
} from '../../../../../Scrapers/Pipeline/Interceptors/WafChallenge/TurnstileCheckboxSolver.js';

interface IFrameBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

describe('TurnstileCheckboxSolver.exports', () => {
  it('is exported as both default and named binding', () => {
    expect(solveTurnstileCheckboxDefault).toBe(solveTurnstileCheckbox);
  });

  it('is callable as an async function with arity 1', () => {
    const kind = typeof solveTurnstileCheckbox;
    expect(kind).toBe('function');
    expect(solveTurnstileCheckbox.length).toBe(1);
  });

  it('does NOT alias to solveHCaptchaCheckbox (registry keeps one kind \u2192 one solver)', () => {
    expect(solveTurnstileCheckbox).not.toBe(solveHCaptchaCheckbox);
  });

  it('delegates to solveHCaptchaCheckbox and returns its outcome', async () => {
    const calls: string[] = [];
    const page = {
      /**
       * Mock waitForLoadState — records the call.
       * @returns Resolved void.
       */
      waitForLoadState: (): Promise<void> => {
        calls.push('waitForLoadState');
        return Promise.resolve();
      },
      /**
       * Mock waitForTimeout — records the call.
       * @returns Resolved void.
       */
      waitForTimeout: (): Promise<void> => {
        calls.push('waitForTimeout');
        return Promise.resolve();
      },
      mouse: {
        /**
         * Mock mouse.click — records the call.
         * @returns Resolved void.
         */
        click: (): Promise<void> => {
          calls.push('mouse.click');
          return Promise.resolve();
        },
      },
    } as unknown as Page;
    const handle = {
      /**
       * Mock boundingBox — returns a fixed box.
       * @returns Resolved IFrameBox.
       */
      boundingBox: (): Promise<IFrameBox> =>
        Promise.resolve({ x: 0, y: 0, width: 20, height: 20 } as IFrameBox),
    } as unknown as ElementHandle;
    const frame = {
      /**
       * Mock frameElement — returns the configured handle.
       * @returns Resolved ElementHandle.
       */
      frameElement: (): Promise<ElementHandle> => Promise.resolve(handle),
    } as unknown as Frame;
    const result = await solveTurnstileCheckbox({ page, frame });
    expect(result).toBe(true);
    expect(calls).toEqual(['waitForLoadState', 'waitForTimeout', 'mouse.click']);
  });
});
