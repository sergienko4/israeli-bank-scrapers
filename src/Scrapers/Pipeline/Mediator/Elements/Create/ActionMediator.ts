/**
 * ActionMediator module — owns `extractActionMediator`, the sealed
 * factory that projects an `IActionMediator` view over a full
 * `IElementMediator`. Holds the cluster builders for the four
 * action-side bundles plus the sessionStorage snapshot helper.
 *
 * The pass-through wrappers (`buildActionNavCluster`,
 * `buildActionDataCluster`) use destructuring shorthand which
 * preserves function identity against the backing IElementMediator.
 *
 * NO setActivePhase, NO setActiveStage, NO network, NO raw Frame —
 * the IActionMediator surface is intentionally sealed to prevent
 * post-AUTH callers from re-entering phase-state mutation.
 */

import type { Page } from 'playwright-core';

import {
  buildFrameRegistry,
  clickElementImpl,
  fillInputImpl,
  type FrameRegistryMap,
  pressEnterImpl,
  resolveFrame,
} from '../ActionExecutors.js';
import { type IActionMediator, type IElementMediator } from '../ElementMediator.js';

export type { FrameRegistryMap };

/**
 * Snapshot sessionStorage into a plain object inside the browser context.
 * Iterates by index because Storage instances do not survive structured-clone
 * via spread, and Sonar S6661 forbids the historic Object.assign pattern.
 * @returns Plain key/value snapshot of sessionStorage.
 */
function snapshotSessionStorage(): Record<string, string> {
  const total = sessionStorage.length;
  const indices = Array.from({ length: total }, (_v, i): number => i);
  const pairs: readonly (readonly [string, string])[] = indices
    .map((i): readonly [string, string] => [sessionStorage.key(i) ?? '', i.toString()])
    .filter(([k]): boolean => k.length > 0)
    .map(([k]): readonly [string, string] => [k, sessionStorage.getItem(k) ?? '']);
  return Object.fromEntries(pairs);
}

/** Frame-bound action methods — fillInput + clickElement + pressEnter. */
type FrameActionBundle = Pick<IActionMediator, 'fillInput' | 'clickElement' | 'pressEnter'>;

/** Navigation pass-through surfaces — bound to the full mediator. */
type ActionNavBundle = Pick<
  IActionMediator,
  'navigateTo' | 'waitForNetworkIdle' | 'waitForURL' | 'getCurrentUrl'
>;

/** Cookie + count + href pass-through surfaces — bound to the full mediator. */
type ActionDataBundle = Pick<
  IActionMediator,
  'getCookies' | 'addCookies' | 'countByText' | 'countBySelector' | 'collectAllHrefs'
>;

/** Combined pass-through bundle — nav + data merged. */
type ActionPassThroughBundle = ActionNavBundle & ActionDataBundle;

/** sessionStorage snapshot surface — page.evaluate wrapper. */
type ActionStorageBundle = Pick<IActionMediator, 'collectStorage'>;

/** Network-derived ACTION surfaces — read-only views over full.network. */
type ActionNetworkBundle = Pick<
  IActionMediator,
  'hasTxnEndpoint' | 'waitForTxnEndpoint' | 'markDashboardClickAt'
>;

/**
 * Build fillInput — resolves the target frame, then delegates to impl.
 * @param registry - The immutable frame registry.
 * @returns Bound fillInput handler.
 */
function buildFillInput(registry: FrameRegistryMap): IActionMediator['fillInput'] {
  return (ctxId, sel, val): Promise<true> => {
    const frame = resolveFrame(registry, ctxId);
    return fillInputImpl(frame, sel, val);
  };
}

/**
 * Build clickElement — destructures IClickElementArgs and forwards to the
 * impl with a resolved frame.
 * @param registry - The immutable frame registry.
 * @returns Bound clickElement handler.
 */
function buildClickElement(registry: FrameRegistryMap): IActionMediator['clickElement'] {
  return (args): Promise<true> => {
    const frame = resolveFrame(registry, args.contextId);
    return clickElementImpl({
      frame,
      selector: args.selector,
      isForce: args.isForce,
      nth: args.nth,
    });
  };
}

/**
 * Build pressEnter — resolves the target frame, then delegates to impl.
 * @param registry - The immutable frame registry.
 * @returns Bound pressEnter handler.
 */
function buildPressEnter(registry: FrameRegistryMap): IActionMediator['pressEnter'] {
  return (ctxId): Promise<true> => {
    const frame = resolveFrame(registry, ctxId);
    return pressEnterImpl(frame);
  };
}

/**
 * Build the 3-method frame-bound execution cluster. Each method is a
 * function-call expression — no inline arrows.
 * @param registry - The immutable frame registry.
 * @returns Frame-action method bundle.
 */
function buildFrameActionCluster(registry: FrameRegistryMap): FrameActionBundle {
  return {
    fillInput: buildFillInput(registry),
    clickElement: buildClickElement(registry),
    pressEnter: buildPressEnter(registry),
  };
}

/**
 * Build the 4-method navigation pass-through cluster. Wraps the matching
 * methods on `full` so the cluster shape stays a flat property table.
 * @param full - The backing full IElementMediator.
 * @returns Navigation pass-through bundle.
 */
function buildActionNavCluster(full: IElementMediator): ActionNavBundle {
  return {
    /** @inheritdoc */
    navigateTo: (...args) => full.navigateTo(...args),
    /** @inheritdoc */
    waitForNetworkIdle: (...args) => full.waitForNetworkIdle(...args),
    /** @inheritdoc */
    waitForURL: (...args) => full.waitForURL(...args),
    /** @inheritdoc */
    getCurrentUrl: () => full.getCurrentUrl(),
  };
}

/**
 * Build the 5-method cookie + count + href pass-through cluster.
 * Wraps the matching methods on `full` so the cluster shape stays a flat
 * property table.
 * @param full - The backing full IElementMediator.
 * @returns Data-surface pass-through bundle.
 */
function buildActionDataCluster(full: IElementMediator): ActionDataBundle {
  return {
    /** @inheritdoc */
    getCookies: () => full.getCookies(),
    /** @inheritdoc */
    addCookies: (...args) => full.addCookies(...args),
    /** @inheritdoc */
    countByText: (...args) => full.countByText(...args),
    /** @inheritdoc */
    countBySelector: (...args) => full.countBySelector(...args),
    /** @inheritdoc */
    collectAllHrefs: () => full.collectAllHrefs(),
  };
}

/**
 * Build the 9-method pass-through cluster — merges nav + data sub-clusters.
 * Identity-preserving (same function references as the backing `full`).
 * @param full - The backing full IElementMediator.
 * @returns Action pass-through method bundle.
 */
function buildActionPassThroughCluster(full: IElementMediator): ActionPassThroughBundle {
  return { ...buildActionNavCluster(full), ...buildActionDataCluster(full) };
}

/**
 * Build collectStorage — snapshots sessionStorage via page.evaluate.
 * @param page - The Playwright page that will execute the snapshot.
 * @returns Bound collectStorage handler.
 */
function buildCollectStorage(page: Page): IActionMediator['collectStorage'] {
  return async (): Promise<Readonly<Record<string, string>>> =>
    page.evaluate(snapshotSessionStorage);
}

/**
 * Build the 1-method sessionStorage snapshot cluster.
 * @param page - The Playwright page that will execute the snapshot.
 * @returns Storage-collection method bundle.
 */
function buildActionStorageCluster(page: Page): ActionStorageBundle {
  return { collectStorage: buildCollectStorage(page) };
}

/**
 * Build hasTxnEndpoint — reports whether the transactions endpoint has
 * been discovered yet on `full.network`.
 * @param full - The backing full IElementMediator (for `full.network`).
 * @returns Bound hasTxnEndpoint handler.
 */
function buildHasTxnEndpoint(full: IElementMediator): IActionMediator['hasTxnEndpoint'] {
  return (): boolean => full.network.discoverTransactionsEndpoint() !== false;
}

/**
 * Build waitForTxnEndpoint — awaits the transactions traffic on
 * `full.network` and normalises the result to a boolean.
 * @param full - The backing full IElementMediator (for `full.network`).
 * @returns Bound waitForTxnEndpoint handler.
 */
function buildWaitForTxnEndpoint(full: IElementMediator): IActionMediator['waitForTxnEndpoint'] {
  return async (timeoutMs): Promise<boolean> => {
    const hit = await full.network.waitForTransactionsTraffic(timeoutMs);
    return hit !== false;
  };
}

/**
 * Build markDashboardClickAt — forwards the click timestamp into
 * `full.network` to seed the post-AUTH transactions watcher.
 * @param full - The backing full IElementMediator (for `full.network`).
 * @returns Bound markDashboardClickAt handler.
 */
function buildMarkDashboardClickAt(
  full: IElementMediator,
): IActionMediator['markDashboardClickAt'] {
  return (timestampMs): true => full.network.markDashboardClickAt(timestampMs);
}

/**
 * Build the 3-method network-derived ACTION cluster. Each method reads or
 * mutates the closure-scoped `full.network` discovery state without
 * exposing the full discovery surface to ACTION callers.
 * @param full - The backing full IElementMediator (for `full.network`).
 * @returns Network-bound action method bundle.
 */
function buildActionNetworkCluster(full: IElementMediator): ActionNetworkBundle {
  return {
    hasTxnEndpoint: buildHasTxnEndpoint(full),
    waitForTxnEndpoint: buildWaitForTxnEndpoint(full),
    markDashboardClickAt: buildMarkDashboardClickAt(full),
  };
}

/**
 * Extract a sealed IActionMediator from a full IElementMediator.
 * Builds a closure-scoped frame registry — private, immutable.
 * NO setActivePhase, NO setActiveStage, NO network, NO raw Frame.
 * @param full - The full element mediator.
 * @param page - The Playwright page (for registry construction).
 * @returns Sealed action-only mediator with contextId-based execution.
 */
export function extractActionMediator(full: IElementMediator, page: Page): IActionMediator {
  const registry = buildFrameRegistry(page);
  return {
    ...buildFrameActionCluster(registry),
    ...buildActionPassThroughCluster(full),
    ...buildActionStorageCluster(page),
    ...buildActionNetworkCluster(full),
  };
}
