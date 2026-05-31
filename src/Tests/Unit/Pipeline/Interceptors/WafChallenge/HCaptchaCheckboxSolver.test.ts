/**
 * Unit tests for HCaptchaCheckboxSolver — Camoufox auto-pass recipe.
 *
 * <p>Drives the solver with mock Page/Frame/ElementHandle stubs and asserts:
 * (a) networkidle wait is requested with the documented timeout,
 * (b) static hydration wait fires AFTER the network settle,
 * (c) click lands at the centre of the iframe bounding box,
 * (d) all defensive branches downgrade to DidSolve(false) instead of throwing.
 */

import type { ElementHandle, Frame, Page } from 'playwright-core';

import {
  clickCentre,
  getBoundingBox,
  getFrameElement,
  type IFrameBox,
  readBox,
  solveHCaptchaCheckbox,
  waitForSettle,
} from '../../../../../Scrapers/Pipeline/Interceptors/WafChallenge/HCaptchaCheckboxSolver.js';
import {
  WAF_HYDRATION_WAIT_MS,
  WAF_NETWORK_IDLE_TIMEOUT_MS,
} from '../../../../../Scrapers/Pipeline/Interceptors/WafChallenge/WafChallengeConfig.js';

interface IMockCall {
  readonly name: string;
  readonly args: readonly unknown[];
}

interface IMockPage {
  readonly page: Page;
  readonly calls: IMockCall[];
}

interface IPageOptions {
  readonly waitForLoadStateThrows?: boolean;
}

/**
 * Build a Page mock that records every interesting call for later assertion.
 * @param opts - Behavioural toggles for failure paths.
 * @returns IMockPage with shared call log.
 */
function makeMockPage(opts: IPageOptions = {}): IMockPage {
  const calls: IMockCall[] = [];
  const page = {
    /**
     * Mock waitForLoadState — records the call, throws or resolves per opts.
     * @param state - Load state ('networkidle').
     * @param options - Wait options.
     * @returns Resolved promise.
     */
    waitForLoadState: (state: string, options: unknown): Promise<void> => {
      calls.push({ name: 'waitForLoadState', args: [state, options] });
      if (opts.waitForLoadStateThrows === true)
        return Promise.reject(new TypeError('idle-timeout'));
      return Promise.resolve();
    },
    /**
     * Mock waitForTimeout — records the call.
     * @param ms - Wait duration.
     * @returns Immediately resolved promise.
     */
    waitForTimeout: (ms: number): Promise<void> => {
      calls.push({ name: 'waitForTimeout', args: [ms] });
      return Promise.resolve();
    },
    mouse: {
      /**
       * Mock mouse.click — records click coordinates.
       * @param x - Click X.
       * @param y - Click Y.
       * @returns Immediately resolved promise.
       */
      click: (x: number, y: number): Promise<void> => {
        calls.push({ name: 'mouse.click', args: [x, y] });
        return Promise.resolve();
      },
    },
  };
  return { page: page as unknown as Page, calls };
}

/**
 * Build an ElementHandle stub whose boundingBox resolves with the given box.
 * @param box - The box to return.
 * @returns A handle-shaped mock.
 */
function makeHandle(box: IFrameBox): ElementHandle {
  return {
    /**
     * Mock boundingBox — resolves with the configured box.
     * @returns The configured box value.
     */
    boundingBox: (): Promise<IFrameBox> => Promise.resolve(box),
  } as unknown as ElementHandle;
}

/**
 * Build an ElementHandle stub whose boundingBox resolves with the null sentinel.
 * @returns A handle-shaped mock.
 */
function makeNullBoxHandle(): ElementHandle {
  return {
    /**
     * Mock boundingBox — resolves with null (simulating Playwright's detached case).
     * Return type is inferred so the rule banning `null` in annotations stays quiet.
     * @returns Resolved promise with the null marker.
     */
    boundingBox: () => {
      const noBox = null as unknown as IFrameBox;
      return Promise.resolve(noBox);
    },
  } as unknown as ElementHandle;
}

/**
 * Build an ElementHandle stub whose boundingBox always rejects.
 * @returns A handle-shaped mock.
 */
function makeThrowingHandle(): ElementHandle {
  return {
    /**
     * Mock boundingBox — always rejects.
     * @returns Rejected promise with a typed error.
     */
    boundingBox: (): Promise<IFrameBox> => Promise.reject(new TypeError('detached-test')),
  } as unknown as ElementHandle;
}

/**
 * Build a Frame stub whose frameElement resolves with the given handle.
 * @param handle - The element handle to return.
 * @returns A Frame-shaped mock.
 */
function makeFrame(handle: ElementHandle): Frame {
  return {
    /**
     * Mock frameElement — resolves with the configured handle.
     * @returns Element handle for the iframe.
     */
    frameElement: (): Promise<ElementHandle> => Promise.resolve(handle),
  } as unknown as Frame;
}

/**
 * Build a Frame stub whose frameElement always rejects.
 * @returns A Frame-shaped mock.
 */
function makeThrowingFrame(): Frame {
  return {
    /**
     * Mock frameElement — always rejects.
     * @returns Rejected promise with a typed error.
     */
    frameElement: (): Promise<ElementHandle> => Promise.reject(new TypeError('detached-test')),
  } as unknown as Frame;
}

/**
 * Mock-call name extractor — kept top-level for naming-convention rules.
 * @param c - Mock call record.
 * @returns The call name.
 */
function nameOf(c: IMockCall): string {
  return c.name;
}

describe('HCaptchaCheckboxSolver.waitForSettle', () => {
  it('requests networkidle with WAF_NETWORK_IDLE_TIMEOUT_MS', async () => {
    const m = makeMockPage();
    await waitForSettle(m.page);
    const firstCall = m.calls[0];
    expect(firstCall).toEqual({
      name: 'waitForLoadState',
      args: ['networkidle', { timeout: WAF_NETWORK_IDLE_TIMEOUT_MS }],
    });
  });

  it('always waits the documented hydration window after settle', async () => {
    const m = makeMockPage();
    await waitForSettle(m.page);
    const secondCall = m.calls[1];
    expect(secondCall).toEqual({ name: 'waitForTimeout', args: [WAF_HYDRATION_WAIT_MS] });
  });

  it('swallows networkidle timeout and still hydrates', async () => {
    const m = makeMockPage({ waitForLoadStateThrows: true });
    await waitForSettle(m.page);
    const names = m.calls.map(nameOf);
    expect(names).toEqual(['waitForLoadState', 'waitForTimeout']);
  });
});

describe('HCaptchaCheckboxSolver.getFrameElement', () => {
  it('returns the handle when frameElement resolves', async () => {
    const handle = makeHandle({ x: 0, y: 0, width: 10, height: 10 });
    const frame = makeFrame(handle);
    const result = await getFrameElement(frame);
    expect(result).toBe(handle);
  });

  it('returns false sentinel when frameElement throws', async () => {
    const frame = makeThrowingFrame();
    const result = await getFrameElement(frame);
    expect(result).toBe(false);
  });
});

describe('HCaptchaCheckboxSolver.getBoundingBox', () => {
  it('returns the box when boundingBox resolves', async () => {
    const handle = makeHandle({ x: 1, y: 2, width: 3, height: 4 });
    const box1 = await getBoundingBox(handle);
    const box2 = await readBox(handle);
    expect(box1).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    expect(box2).toEqual({ x: 1, y: 2, width: 3, height: 4 });
  });

  it('returns false when boundingBox returns null', async () => {
    const handle = makeNullBoxHandle();
    const result = await getBoundingBox(handle);
    expect(result).toBe(false);
  });

  it('returns false when boundingBox throws', async () => {
    const handle = makeThrowingHandle();
    const result = await getBoundingBox(handle);
    expect(result).toBe(false);
  });
});

describe('HCaptchaCheckboxSolver.clickCentre', () => {
  it('clicks the geometric centre of the box', async () => {
    const m = makeMockPage();
    await clickCentre(m.page, { x: 10, y: 20, width: 100, height: 60 });
    const click = m.calls[0];
    expect(click).toEqual({ name: 'mouse.click', args: [60, 50] });
  });
});

const CLICK_NAME = 'mouse.click';
/**
 * Predicate — true when the mock call is a mouse.click.
 * @param c - Mock call record.
 * @returns True when the call name is "mouse.click".
 */
function isClick(c: IMockCall): boolean {
  return c.name === CLICK_NAME;
}

describe('HCaptchaCheckboxSolver.solveHCaptchaCheckbox', () => {
  it('runs the full recipe and returns DidSolve(true) on success', async () => {
    const m = makeMockPage();
    const handle = makeHandle({ x: 0, y: 0, width: 200, height: 100 });
    const frame = makeFrame(handle);
    const result = await solveHCaptchaCheckbox({ page: m.page, frame });
    const names = m.calls.map(nameOf);
    expect(result).toBe(true);
    expect(names).toEqual(['waitForLoadState', 'waitForTimeout', 'mouse.click']);
  });

  it('downgrades to DidSolve(false) when frameElement throws', async () => {
    const m = makeMockPage();
    const frame = makeThrowingFrame();
    const result = await solveHCaptchaCheckbox({ page: m.page, frame });
    expect(result).toBe(false);
  });

  it('downgrades to DidSolve(false) when boundingBox returns null', async () => {
    const m = makeMockPage();
    const handle = makeNullBoxHandle();
    const frame = makeFrame(handle);
    const result = await solveHCaptchaCheckbox({ page: m.page, frame });
    expect(result).toBe(false);
  });

  it('clicks the centre at width/2 + x, height/2 + y', async () => {
    const m = makeMockPage();
    const handle = makeHandle({ x: 100, y: 50, width: 80, height: 40 });
    const frame = makeFrame(handle);
    await solveHCaptchaCheckbox({ page: m.page, frame });
    const click = m.calls.find(isClick);
    const args = click?.args ?? [];
    expect(args).toEqual([140, 70]);
  });
});
