/**
 * Unit tests for ActionExecutors — candidateToSelector, raceResultToTarget,
 * and fill/click/pressEnter flows via mocked Playwright primitives.
 */

import type { Frame, Locator, Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../../../Scrapers/Base/Config/LoginConfigTypes.js';
import {
  candidateToSelector,
  clickElementImpl,
  fillInputImpl,
  pressEnterImpl,
  raceResultToTarget,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/ActionExecutors.js';
import type { IRaceResult } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { NOT_FOUND_RESULT } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { makeFrame, makeLocator } from './ActionExecutorsHelpers.js';

describe('candidateToSelector', () => {
  it('builds text= selector for textContent kind', () => {
    const c: SelectorCandidate = { kind: 'textContent', value: 'Go' };
    const candidateToSelectorResult1 = candidateToSelector(c);
    expect(candidateToSelectorResult1).toBe('text=Go');
  });
  it('builds quoted exactText selector', () => {
    const candidateToSelectorResult2 = candidateToSelector({ kind: 'exactText', value: 'Go' });
    expect(candidateToSelectorResult2).toBe('text="Go"');
  });
  it('builds tag-agnostic [aria-label] selector for ariaLabel', () => {
    const candidateToSelectorResult3 = candidateToSelector({ kind: 'ariaLabel', value: 'Next' });
    expect(candidateToSelectorResult3).toBe('[aria-label="Next"]');
  });
  it('builds placeholder selector', () => {
    const candidateToSelectorResult4 = candidateToSelector({ kind: 'placeholder', value: 'pw' });
    expect(candidateToSelectorResult4).toBe('[placeholder="pw"]');
  });
  it('pass-through for xpath and css', () => {
    const candidateToSelectorResult5 = candidateToSelector({ kind: 'xpath', value: '//a' });
    expect(candidateToSelectorResult5).toBe('//a');
    const candidateToSelectorResult6 = candidateToSelector({ kind: 'css', value: '#a' });
    expect(candidateToSelectorResult6).toBe('#a');
  });
  it('builds name selector', () => {
    const candidateToSelectorResult7 = candidateToSelector({ kind: 'name', value: 'p' });
    expect(candidateToSelectorResult7).toBe('[name="p"]');
  });
  it('builds regex selector', () => {
    const candidateToSelectorResult8 = candidateToSelector({ kind: 'regex', value: '\\d+' });
    expect(candidateToSelectorResult8).toBe('text=/\\d+/');
  });
  it('fallback default builder returns text=', () => {
    const c = { kind: 'unknownKind' as unknown as SelectorCandidate['kind'], value: 'v' };
    const candidateToSelectorResult9 = candidateToSelector(c as SelectorCandidate);
    expect(candidateToSelectorResult9).toBe('text=v');
  });
  it('builds labelText selector', () => {
    const candidateToSelectorResult10 = candidateToSelector({ kind: 'labelText', value: 'User' });
    expect(candidateToSelectorResult10).toBe('text=User');
  });
  it('builds clickableText selector', () => {
    const candidateToSelectorResult11 = candidateToSelector({
      kind: 'clickableText',
      value: 'Button',
    });
    expect(candidateToSelectorResult11).toBe('text=Button');
  });
});

describe('raceResultToTarget', () => {
  const makeLocatorResult12 = makeLocator();
  const page = makeFrame(makeLocatorResult12);

  it('returns false when race not found', () => {
    const raceResultToTargetResult13 = raceResultToTarget(NOT_FOUND_RESULT, page);
    expect(raceResultToTargetResult13).toBe(false);
  });

  it('builds IResolvedTarget from a found race result on the main page', () => {
    const result: IRaceResult = {
      found: true,
      locator: makeLocator(),
      candidate: { kind: 'textContent', value: 'Login' },
      context: page,
      index: 0,
      value: 'Login',
      identity: false,
    };
    const target = raceResultToTarget(result, page);
    expect(target).not.toBe(false);
    if (target) {
      expect(target.contextId).toBe('main');
      expect(target.selector).toBe('text=Login');
      expect(target.candidateValue).toBe('Login');
    }
  });

  it('returns false when context missing', () => {
    const result: IRaceResult = {
      found: true,
      locator: makeLocator(),
      candidate: { kind: 'css', value: '#a' },
      context: false,
      index: 0,
      value: '',
      identity: false,
    };
    const raceResultToTargetResult14 = raceResultToTarget(result, page);
    expect(raceResultToTargetResult14).toBe(false);
  });

  it('returns false when candidate missing', () => {
    const result: IRaceResult = {
      found: true,
      locator: makeLocator(),
      candidate: false,
      context: page,
      index: 0,
      value: '',
      identity: false,
    };
    const raceResultToTargetResult15 = raceResultToTarget(result, page);
    expect(raceResultToTargetResult15).toBe(false);
  });

  // Identity-based selector branches are covered in
  // ActionExecutorsIdentity.test.ts (split out to keep this file under the
  // 300-line lint gate).
});

describe('fillInputImpl', () => {
  it('fills input then returns true', async () => {
    const loc = makeLocator({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      count: (): Promise<number> => Promise.resolve(1),
    });
    const frame = makeFrame(loc);
    const isOk = await fillInputImpl(frame, '#x', 'value');
    expect(isOk).toBe(true);
  });
});

describe('clickElementImpl', () => {
  it('natural click path returns true on success', async () => {
    const loc = makeLocator();
    const frame = makeFrame(loc);
    const isOk = await clickElementImpl({ frame, selector: '#btn' });
    expect(isOk).toBe(true);
  });

  it('force click tier 1 success returns true', async () => {
    const loc = makeLocator({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      click: (): Promise<boolean> => Promise.resolve(true),
    });
    const frame = makeFrame(loc);
    const isOk = await clickElementImpl({ frame, selector: '#btn', isForce: true });
    expect(isOk).toBe(true);
  });

  it('force click falls through tier 1 fail → tier 2 dispatch success', async () => {
    const loc = makeLocator({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      click: (): Promise<boolean> => Promise.reject(new Error('tier1 fail')),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      dispatchEvent: (): Promise<boolean> => Promise.resolve(true),
    });
    const frame = makeFrame(loc);
    const isOk = await clickElementImpl({ frame, selector: '#btn', isForce: true });
    expect(isOk).toBe(true);
  });

  it('force click tier 3 evaluate success returns true', async () => {
    const loc = makeLocator({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      click: (): Promise<boolean> => Promise.reject(new Error('tier1 fail')),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      dispatchEvent: (): Promise<boolean> => Promise.reject(new Error('tier2 fail')),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      evaluate: (): Promise<boolean> => Promise.resolve(true),
    });
    const frame = makeFrame(loc);
    const isOk = await clickElementImpl({ frame, selector: '#btn', isForce: true });
    expect(isOk).toBe(true);
  });

  it('force click tier 3 fail → tier 4 aria-label path still returns true', async () => {
    const loc = makeLocator({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      click: (): Promise<boolean> => Promise.reject(new Error('tier1 fail')),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      dispatchEvent: (): Promise<boolean> => Promise.reject(new Error('tier2 fail')),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      evaluate: (): Promise<boolean> => Promise.reject(new Error('tier3 fail')),
    });
    const frame = makeFrame(loc);
    const isOk = await clickElementImpl({
      frame,
      selector: 'role=button[name="OK"]',
      isForce: true,
    });
    expect(isOk).toBe(true);
  });
});

describe('pressEnterImpl', () => {
  it('presses Enter via page keyboard', async () => {
    const loc = makeLocator();
    const page = makeFrame(loc);
    const isOk = await pressEnterImpl(page);
    expect(isOk).toBe(true);
  });

  it('presses Enter via frame.page() keyboard for Frame contexts', async () => {
    const loc = makeLocator();
    const page = makeFrame(loc);
    const frame = {
      /**
       * page accessor.
       * @returns Page reference.
       */
      page: (): Page => page,
    } as unknown as Frame;
    const isOk = await pressEnterImpl(frame);
    expect(isOk).toBe(true);
  });
});

// ── Tier 4 clickViaAriaLabel coverage: runs frame.evaluate callback with fake DOM ──

describe('clickElementImpl — Tier 4 aria-label DOM fallback branches', () => {
  /** Restore document after each test. */
  const origDoc = (globalThis as { document?: unknown }).document;
  afterEach(() => {
    (globalThis as { document?: unknown }).document = origDoc;
  });

  it('selector without name="..." triggers early-return (line 149 branch)', async () => {
    const loc = makeLocator({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      click: (): Promise<boolean> => Promise.reject(new Error('t1')),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      dispatchEvent: (): Promise<boolean> => Promise.reject(new Error('t2')),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      evaluate: (): Promise<boolean> => Promise.reject(new Error('t3')),
    });
    const frame = makeFrame(loc);
    const isOk = await clickElementImpl({ frame, selector: '#no-aria-here', isForce: true });
    expect(isOk).toBe(true);
  });

  it('selector with aria-label + fake document.querySelectorAll returns buttons → lastBtn.click()', async () => {
    let clickCount = 0;
    const fakeBtns = [
      {
        /**
         * Test helper.
         *
         * @returns Result.
         */
        click: (): boolean => {
          return true; /* first */
        },
      },
      {
        /**
         * Test helper.
         *
         * @returns Result.
         */
        click: (): boolean => {
          clickCount += 1;
          return true;
        },
      }, // lastBtn
    ];
    (globalThis as { document?: unknown }).document = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      querySelectorAll: (): readonly { click: () => boolean }[] => fakeBtns,
    };
    const loc = makeLocator({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      click: (): Promise<boolean> => Promise.reject(new Error('t1')),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      dispatchEvent: (): Promise<boolean> => Promise.reject(new Error('t2')),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      evaluate: (): Promise<boolean> => Promise.reject(new Error('t3')),
    });
    const frame = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      locator: (): Locator => loc,
      // frame.evaluate actually runs the callback — this exercises
      // clickViaAriaLabel's inline function (anonymous_13 in the source).
      /**
       * Test helper.
       *
       * @param cb - Parameter.
       * @param arg - Parameter.
       * @returns Result.
       */
      evaluate: <T>(cb: (label: string) => T, arg: string): Promise<T> => {
        const cbResult = cb(arg);
        return Promise.resolve(cbResult);
      },
      keyboard: {
        /**
         * Test helper.
         *
         * @returns Result.
         */
        press: (): Promise<boolean> => Promise.resolve(true),
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      page: function (): Page {
        return this as unknown as Page;
      },
    } as unknown as Page;
    const isOk = await clickElementImpl({
      frame,
      selector: 'role=button[name="OK"]',
      isForce: true,
    });
    expect(isOk).toBe(true);
    expect(clickCount).toBe(1);
  });

  it('aria-label path with empty querySelectorAll (lastBtn === undefined branch)', async () => {
    (globalThis as { document?: unknown }).document = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      querySelectorAll: (): readonly never[] => [],
    };
    const loc = makeLocator({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      click: (): Promise<boolean> => Promise.reject(new Error('t1')),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      dispatchEvent: (): Promise<boolean> => Promise.reject(new Error('t2')),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      evaluate: (): Promise<boolean> => Promise.reject(new Error('t3')),
    });
    const frame = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      locator: (): Locator => loc,
      /**
       * Test helper.
       *
       * @param cb - Parameter.
       * @param arg - Parameter.
       * @returns Result.
       */
      evaluate: <T>(cb: (label: string) => T, arg: string): Promise<T> => {
        const cbResult = cb(arg);
        return Promise.resolve(cbResult);
      },
      keyboard: {
        /**
         * Test helper.
         *
         * @returns Result.
         */
        press: (): Promise<boolean> => Promise.resolve(true),
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      page: function (): Page {
        return this as unknown as Page;
      },
    } as unknown as Page;
    const isOk = await clickElementImpl({
      frame,
      selector: 'role=button[name="X"]',
      isForce: true,
    });
    expect(isOk).toBe(true);
  });

  it('Tier 4 with frame.evaluate rejection falls through via catch', async () => {
    const loc = makeLocator({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      click: (): Promise<boolean> => Promise.reject(new Error('t1')),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      dispatchEvent: (): Promise<boolean> => Promise.reject(new Error('t2')),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      evaluate: (): Promise<boolean> => Promise.reject(new Error('t3')),
    });
    const frame = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      locator: (): Locator => loc,
      /**
       * Test helper.
       *
       * @returns Result.
       */
      evaluate: (): Promise<never> => Promise.reject(new Error('frame eval fail')),
      keyboard: {
        /**
         * Test helper.
         *
         * @returns Result.
         */
        press: (): Promise<boolean> => Promise.resolve(true),
      },
      /**
       * Test helper.
       *
       * @returns Result.
       */
      page: function (): Page {
        return this as unknown as Page;
      },
    } as unknown as Page;
    const isOk = await clickElementImpl({
      frame,
      selector: 'role=button[name="Z"]',
      isForce: true,
    });
    expect(isOk).toBe(true);
  });
});
