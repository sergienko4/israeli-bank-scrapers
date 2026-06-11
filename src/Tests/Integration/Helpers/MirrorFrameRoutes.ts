/**
 * MirrorFrameRoutes — load per-step `frames.json` + per-frame HTML
 * bodies so {@link MirrorInterceptor} can serve cross-origin iframe
 * navigations from disk instead of letting the browser hit the
 * real network.
 *
 * <p>Motivating banks: VisaCal hosts the password form inside the
 * `connect.cal-online.co.il/regular-login` iframe; AMEX hosts SSO
 * widgets inside multiple cross-origin iframes. Without iframe
 * routing the production `LoginFieldDiscovery` cannot reach the
 * credential inputs (they live inside a blank/about:blank frame).
 *
 * <p>URL matching is normalized on `origin + pathname` to tolerate
 * query/hash variance between harvest-time and replay-time. The
 * top frame (index 0) is skipped because it is already served by
 * {@link MirrorInterceptor.routeHandler}'s `shouldServeHtml` path.
 *
 * <p>All helpers are ≤10 lines per CLAUDE.md.
 */

import * as fs from 'node:fs/promises';

import { resolveFixtureRoot } from './FixturePage.js';

const FRAME_INDEX_TOP = 0;
const FRAME_ABOUT_BLANK = 'about:blank';

/** Manifest row written by HarvestBankHtml.buildFramesIndexWrite. */
interface IFrameMetaRow {
  readonly index: number;
  readonly name: string;
  readonly url: string;
  readonly file: string;
}

/** Frames-manifest row list — alias so signatures fit Prettier's 100-col cap. */
type IFrameMetaRows = readonly IFrameMetaRow[];

/** Empty-frames singleton — avoids per-call array allocation. */
const NO_FRAMES: IFrameMetaRows = Object.freeze([]);

/**
 * Type guard for IFrameMetaRow rows parsed from frames.json.
 * @param value - Candidate value.
 * @returns True when value has the expected manifest shape.
 */
function isFrameMetaRow(value: unknown): value is IFrameMetaRow {
  if (value === null) return false;
  if (typeof value !== 'object') return false;
  const c = value as Record<string, unknown>;
  return frameMetaShapeIsValid(c);
}

/**
 * Verify the four required fields of a candidate manifest row.
 * Extracted to keep {@link isFrameMetaRow} under the 10-line cap.
 * @param c - Candidate object.
 * @returns True when all four fields have the expected types.
 */
function frameMetaShapeIsValid(c: Record<string, unknown>): boolean {
  if (typeof c.index !== 'number') return false;
  if (typeof c.name !== 'string') return false;
  if (typeof c.url !== 'string') return false;
  return typeof c.file === 'string';
}

/**
 * Normalize a URL to `origin + pathname` so harvest-time captures
 * match replay-time requests across query/hash variance.
 * Returns the empty-string sentinel for malformed URLs.
 * @param url - Candidate URL.
 * @returns Normalized key or empty string.
 */
function normalizeFrameUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return '';
  }
}

/**
 * Skip top-level / empty / about:blank rows. They either have no
 * routable URL or are already served by the main HTML route.
 * @param frame - Candidate manifest row.
 * @returns True when the row maps to a real iframe document.
 */
function isRoutableFrame(frame: IFrameMetaRow): boolean {
  if (frame.index === FRAME_INDEX_TOP) return false;
  if (frame.url === '') return false;
  return frame.url !== FRAME_ABOUT_BLANK;
}

/**
 * Read the per-step `frames.json` manifest from disk.
 * Returns the empty-frames singleton when the file is missing or
 * malformed — keeps callers branch-free for the no-frames case.
 * @param root - Absolute fixture-root directory for the bank.
 * @param stepName - Step name (matches `<step>/frames.json`).
 * @returns Manifest rows (possibly empty).
 */
async function readFramesManifest(root: string, stepName: string): Promise<IFrameMetaRows> {
  try {
    const raw = await fs.readFile(`${root}/${stepName}/frames.json`, 'utf8');
    return parseFramesArray(raw);
  } catch {
    return NO_FRAMES;
  }
}

/**
 * Parse + filter the raw frames.json string.
 * Extracted so {@link readFramesManifest} stays under the 10-line cap.
 * @param raw - UTF-8 file contents.
 * @returns Filtered manifest rows (possibly empty).
 */
function parseFramesArray(raw: string): IFrameMetaRows {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return NO_FRAMES;
  return parsed.filter(isFrameMetaRow);
}

/**
 * Extract the host portion of a URL, returning '' for malformed URLs.
 * @param url - Candidate URL.
 * @returns Host or empty-string sentinel.
 */
function safeFrameHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/**
 * Push one frame's body into BOTH the URL-keyed and host-keyed maps.
 * The host map is filled only when a host appears in exactly one frame
 * (so multi-frame hosts stay unambiguous and fall back to URL-only).
 * @param args - Root + step + frame row + the mutable maps being filled.
 * @returns True after the push gate is evaluated.
 */
async function pushFrameRoute(args: IPushFrameRouteArgs): Promise<true> {
  if (!isRoutableFrame(args.frame)) return true;
  const key = normalizeFrameUrl(args.frame.url);
  if (key === '') return true;
  const body = await fs.readFile(`${args.root}/${args.stepName}/${args.frame.file}`, 'utf8');
  recordRoutes({ body, key, frame: args.frame, urlMap: args.urlMap, hostMap: args.hostMap });
  return true;
}

/**
 * Record one frame's body into URL + host maps.
 * Extracted to keep {@link pushFrameRoute} under the 10-line cap.
 * @param args - Body + URL key + frame + maps.
 * @returns True after the record gate is evaluated.
 */
function recordRoutes(args: IRecordRoutesArgs): true {
  args.urlMap.set(args.key, args.body);
  const host = safeFrameHost(args.frame.url);
  if (host === '') return true;
  const sentinel = args.hostMap.get(host);
  if (sentinel === undefined) args.hostMap.set(host, args.body);
  else if (sentinel !== args.body) args.hostMap.set(host, HOST_AMBIGUOUS);
  return true;
}

/** Sentinel: host has multiple frames with different bodies — no fallback. */
const HOST_AMBIGUOUS = '\u0000__AMBIGUOUS__\u0000' as const;

/** Args bundle for {@link recordRoutes} — respects the 3-param ceiling. */
interface IRecordRoutesArgs {
  readonly body: string;
  readonly key: string;
  readonly frame: IFrameMetaRow;
  readonly urlMap: Map<string, string>;
  readonly hostMap: Map<string, string>;
}

/** Args bundle for {@link pushFrameRoute} — respects the 3-param ceiling. */
interface IPushFrameRouteArgs {
  readonly root: string;
  readonly stepName: string;
  readonly frame: IFrameMetaRow;
  readonly urlMap: Map<string, string>;
  readonly hostMap: Map<string, string>;
}

/**
 * Two-tier URL→HTML lookup: (1) exact origin+pathname match captured
 * at harvest time, (2) host-based fallback when the harvest URL drifted
 * (e.g. SPA replaced the iframe's initial src with a deeper route).
 */
interface IFrameRouteMaps {
  readonly byUrl: ReadonlyMap<string, string>;
  readonly byHost: ReadonlyMap<string, string>;
}

/** Shared empty maps singleton — used when frames.json is missing. */
const NO_FRAME_ROUTE_MAPS: IFrameRouteMaps = {
  byUrl: new Map<string, string>(),
  byHost: new Map<string, string>(),
};

/** Args bundle for {@link pushAllFramesAtIdx} — respects the 3-param ceiling. */
interface IPushAllFramesArgs {
  readonly root: string;
  readonly stepName: string;
  readonly frames: IFrameMetaRows;
  readonly urlMap: Map<string, string>;
  readonly hostMap: Map<string, string>;
}

/**
 * Build the {@link IPushFrameRouteArgs} bundle for the frame at `idx`.
 * Extracted from {@link pushAllFramesAtIdx} so the recursive walker
 * stays under the 10-line cap (per CLAUDE.md).
 * @param args - Bundle of root + stepName + frames + maps.
 * @param idx - Frame index to project.
 * @returns Args bundle ready to pass to {@link pushFrameRoute}.
 */
function buildPushArgs(args: IPushAllFramesArgs, idx: number): IPushFrameRouteArgs {
  return {
    root: args.root,
    stepName: args.stepName,
    frame: args.frames[idx],
    urlMap: args.urlMap,
    hostMap: args.hostMap,
  };
}

/**
 * Walk the frames manifest recursively (no `await` in loop) and push
 * each routable frame's body into the URL + host maps.
 * @param args - Bundle of root + stepName + frames + maps.
 * @param idx - Current frame index.
 * @returns True once every frame has been processed.
 */
async function pushAllFramesAtIdx(args: IPushAllFramesArgs, idx: number): Promise<true> {
  if (idx >= args.frames.length) return true;
  const pushArgs = buildPushArgs(args, idx);
  await pushFrameRoute(pushArgs);
  return pushAllFramesAtIdx(args, idx + 1);
}

/**
 * Load every routable frame's HTML body into URL + host maps from an
 * explicit fixture root. Production callers should use the bankId
 * convenience wrapper {@link loadFrameRoutes}; unit tests use this
 * core to redirect into a tmpdir.
 * @param root - Absolute bank fixture root.
 * @param stepName - Step name.
 * @returns Immutable URL + host maps.
 */
async function loadFrameRoutesFromRoot(root: string, stepName: string): Promise<IFrameRouteMaps> {
  const frames = await readFramesManifest(root, stepName);
  if (frames.length === 0) return NO_FRAME_ROUTE_MAPS;
  const urlMap = new Map<string, string>();
  const hostMap = new Map<string, string>();
  await pushAllFramesAtIdx({ root, stepName, frames, urlMap, hostMap }, 0);
  return { byUrl: urlMap, byHost: hostMap };
}

/**
 * Load every routable frame's HTML body into URL + host maps using
 * the production fixtures layout (`{repoRoot}/.../banks/{bankId}`).
 * @param bankId - Bank recipe id.
 * @param stepName - Step name.
 * @returns Immutable URL + host maps.
 */
async function loadFrameRoutes(bankId: string, stepName: string): Promise<IFrameRouteMaps> {
  const root = resolveFixtureRoot(bankId);
  return loadFrameRoutesFromRoot(root, stepName);
}

export type { IFrameMetaRow, IFrameRouteMaps };
export {
  HOST_AMBIGUOUS,
  loadFrameRoutes,
  loadFrameRoutesFromRoot,
  normalizeFrameUrl,
  safeFrameHost,
};
