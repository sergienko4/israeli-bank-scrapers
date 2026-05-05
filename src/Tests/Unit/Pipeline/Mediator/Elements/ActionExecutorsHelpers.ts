/**
 * Shared mock locator + frame factories for ActionExecutors split test files.
 */

import type { Locator, Page } from 'playwright-core';

/** Behaviour script for a mock locator. */
export interface ILocatorScript {
  click?: () => Promise<boolean>;
  fill?: () => Promise<boolean>;
  focus?: () => Promise<boolean>;
  pressSequentially?: () => Promise<boolean>;
  dispatchEvent?: () => Promise<boolean>;
  evaluate?: () => Promise<unknown>;
  getAttribute?: () => Promise<string | false>;
  count?: () => Promise<number>;
}

/**
 * Build a mock locator with scripted Playwright methods.
 * @param script - Behaviour overrides.
 * @returns Mock Locator.
 */
export function makeLocator(script: ILocatorScript = {}): Locator {
  const self = {
    /**
     * First.
     * @returns Self.
     */
    first: (): Locator => self as unknown as Locator,
    /**
     * Click.
     * @returns Scripted click.
     */
    click: script.click ?? ((): Promise<boolean> => Promise.resolve(true)),
    /**
     * Fill.
     * @returns Scripted fill.
     */
    fill: script.fill ?? ((): Promise<boolean> => Promise.resolve(true)),
    /**
     * Focus.
     * @returns Scripted focus.
     */
    focus: script.focus ?? ((): Promise<boolean> => Promise.resolve(true)),
    /**
     * pressSequentially.
     * @returns Scripted press.
     */
    pressSequentially: script.pressSequentially ?? ((): Promise<boolean> => Promise.resolve(true)),
    /**
     * dispatchEvent.
     * @returns Scripted dispatch.
     */
    dispatchEvent: script.dispatchEvent ?? ((): Promise<boolean> => Promise.resolve(true)),
    /**
     * evaluate.
     * @returns Scripted evaluate.
     */
    evaluate: script.evaluate ?? ((): Promise<unknown> => Promise.resolve(false)),
    /**
     * getAttribute.
     * @returns Scripted attribute.
     */
    getAttribute: script.getAttribute ?? ((): Promise<string | false> => Promise.resolve(false)),
    /**
     * count.
     * @returns Scripted count (default 1).
     */
    count: script.count ?? ((): Promise<number> => Promise.resolve(1)),
  };
  return self as unknown as Locator;
}

/**
 * Build a mock Frame/Page that returns scripted locators + keyboard.
 * @param loc - Locator to return for any selector.
 * @returns Mock frame.
 */
export function makeFrame(loc: Locator): Page {
  const self = {
    /**
     * Locator.
     * @returns Scripted locator.
     */
    locator: (): Locator => loc,
    /**
     * evaluate — passthrough noop.
     * @returns Resolved true.
     */
    evaluate: (): Promise<boolean> => Promise.resolve(true),
    keyboard: {
      /**
       * Press.
       * @returns Resolved.
       */
      press: (): Promise<boolean> => Promise.resolve(true),
    },
    /**
     * page accessor for Frame-style calls.
     * @returns Self.
     */
    page: (): Page => self as unknown as Page,
  };
  return self as unknown as Page;
}
