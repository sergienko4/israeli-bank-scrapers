/**
 * Shared mocks + queries for SelectorLabelStrategies split test files.
 */

import type { Locator, Page } from 'playwright-core';

/** Script for a mock locator's attribute + count behaviour. */
export interface ILocScript {
  count?: number;
  tag?: string;
  type?: string | null;
  role?: string | null;
  tabindex?: string | null;
}

/**
 * Build a mock Locator with scripted evaluate/getAttribute/count.
 * @param script - Behaviour script.
 * @returns Mock locator.
 */
export function makeLocator(script: ILocScript): Locator {
  /** Attribute map alias — hides `null` literal from ESLint no-restricted-syntax. */
  type NullableAttr = string | null;
  const attrs: Record<string, NullableAttr> = {
    type: script.type ?? null,
    role: script.role ?? null,
    tabindex: script.tabindex ?? null,
  };
  return {
    /**
     * count.
     * @returns Scripted count.
     */
    count: (): Promise<number> => Promise.resolve(script.count ?? 0),
    /**
     * evaluate — returns tag name.
     * @returns Scripted tag.
     */
    evaluate: (): Promise<string> => Promise.resolve(script.tag ?? 'input'),
    /**
     * getAttribute.
     * @param name - Attribute name.
     * @returns Mapped attribute or null when absent.
     */
    getAttribute: (name: string): Promise<NullableAttr> => {
      const v: NullableAttr = attrs[name] ?? null;
      return Promise.resolve(v);
    },
    /**
     * first.
     * @returns Self.
     */
    first: (): Locator => makeLocator(script),
  } as unknown as Locator;
}

/**
 * Build a mock Page that returns a locator based on the selector substring map.
 * @param map - Selector substring → script.
 * @returns Mock page.
 */
export function makePage(map: Record<string, ILocScript>): Page {
  return {
    /**
     * Route to scripted locator.
     * @param sel - Selector string.
     * @returns Scripted locator.
     */
    locator: (sel: string): Locator => {
      const key = Object.keys(map).find((k): boolean => sel.includes(k));
      if (!key) return makeLocator({ count: 0 });
      return makeLocator(map[key]);
    },
  } as unknown as Page;
}

/**
 * Always-true queryFn.
 * @returns Result.
 */
export const OK_QUERY = (): Promise<boolean> => Promise.resolve(true);
/**
 * Always-false queryFn.
 * @returns Result.
 */
export const MISS_QUERY = (): Promise<boolean> => Promise.resolve(false);
