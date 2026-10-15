/**
 * Directional diff of two normalized Juggler schemas: the
 * client (playwright-core's bundled copy) against the browser (Camoufox).
 *
 * - **request** — the client sends method params; the browser validates them
 *   strictly, so the client's params must be assignable to the browser's.
 * - **return** — the browser answers; the client reads the fields it knows, so
 *   the browser's return must be assignable to the client's.
 * - **event** — the browser emits a payload; same direction as `return`.
 *
 * A method or event only the browser has is never called or subscribed by
 * the client, so it is not a delta.
 */
import { objectAssign } from './juggler-assign.mjs';
import { parseJugglerSchema } from './juggler-schema.mjs';
import { fieldsSig, pairSig } from './juggler-sig.mjs';
import { DELTA_CHANNELS } from './manifest.mjs';

/**
 * @typedef {import('./juggler-schema.d.mts').NormalizedSchema} NormalizedSchema
 * @typedef {import('./juggler-schema.d.mts').IMethod} IMethod
 * @typedef {import('./juggler-schema.d.mts').IDomain['events'][string]} Fields
 * @typedef {import('./juggler-diff.d.mts').IJugglerDelta} IJugglerDelta
 */

/**
 * Both schemas of one diff and the deltas collected so far.
 *
 * @typedef {object} Run
 * @property {NormalizedSchema} client - playwright-core's schema.
 * @property {NormalizedSchema} browser - Camoufox's schema.
 * @property {IJugglerDelta[]} out - Collected deltas.
 */

/**
 * Own property or undefined — names such as `constructor` stay data.
 *
 * @template T
 * @param {Readonly<Record<string, T>>} obj - Map to read.
 * @param {string} key - Property name.
 * @returns {T | undefined} The own value, else undefined.
 */
const own = (obj, key) => (Object.hasOwn(obj, key) ? obj[key] : undefined);

/** Sorted own keys. */
const keysOf = (/** @type {object} */ obj) => Object.keys(obj).sort();

/** @returns {import('./juggler-assign.mjs').Cursor} A cursor at `path` on `channel`, fresh. */
function cursor(
  /** @type {Run} */ run,
  /** @type {import('./juggler-diff.d.mts').DeltaChannel} */ channel,
  /** @type {string} */ path,
) {
  const toBrowser = channel === 'request';
  const [src, dst] = toBrowser ? [run.client, run.browser] : [run.browser, run.client];
  const types = { srcTypes: src.namespaces, dstTypes: dst.namespaces };
  return { channel, path, out: run.out, ...types };
}

/** Request and return deltas of one client method. */
function diffMethod(
  /** @type {Run} */ run,
  /** @type {string} */ path,
  /** @type {[IMethod, IMethod | undefined]} */ pair,
) {
  const [mine, theirs] = pair;
  if (theirs === undefined) {
    const signature = pairSig(fieldsSig(mine.params), 'absent');
    return run.out.push({ channel: 'request', kind: 'MISSING-METHOD', path, signature });
  }
  objectAssign(mine.params, theirs.params, cursor(run, 'request', path));
  objectAssign(theirs.returns, mine.returns, cursor(run, 'return', path));
}

/** Event deltas of one client event. */
function diffEvent(
  /** @type {Run} */ run,
  /** @type {string} */ path,
  /** @type {[Fields, Fields | undefined]} */ pair,
) {
  const [mine, theirs] = pair;
  if (theirs !== undefined) return objectAssign(theirs, mine, cursor(run, 'event', path));
  const signature = pairSig('absent', fieldsSig(mine));
  run.out.push({ channel: 'event', kind: 'MISSING-EVENT', path, signature });
}

/** Every client method and event of one domain against the browser's. */
function diffDomain(/** @type {Run} */ run, /** @type {string} */ name) {
  const mine = run.client.domains[name];
  const theirs = own(run.browser.domains, name) ?? { methods: {}, events: {} };
  for (const m of keysOf(mine.methods))
    diffMethod(run, `${name}.${m}`, [mine.methods[m], own(theirs.methods, m)]);
  for (const e of keysOf(mine.events))
    diffEvent(run, `${name}.${e}`, [mine.events[e], own(theirs.events, e)]);
}

/** Codepoint order (locale-independent), as manifest paths are compared. */
const byCodepoint = (/** @type {string} */ a, /** @type {string} */ b) =>
  a < b ? -1 : Number(a > b);

/**
 * Deterministic delta order: channel (request, return, event), path, kind.
 *
 * @param {Pick<IJugglerDelta, 'channel' | 'path' | 'kind'>} a - First delta.
 * @param {Pick<IJugglerDelta, 'channel' | 'path' | 'kind'>} b - Second delta.
 * @returns {number} Negative, zero or positive.
 */
export function compareDeltas(a, b) {
  const channel = DELTA_CHANNELS.indexOf(a.channel) - DELTA_CHANNELS.indexOf(b.channel);
  return channel || byCodepoint(a.path, b.path) || byCodepoint(a.kind, b.kind);
}

/**
 * Deltas between a client and a browser schema, sorted by {@link compareDeltas}.
 *
 * @param {NormalizedSchema} client - playwright-core's schema.
 * @param {NormalizedSchema} browser - Camoufox's schema.
 * @returns {IJugglerDelta[]} Every delta, deterministic.
 */
export function diffSchemas(client, browser) {
  /** @type {Run} */
  const run = { client, browser, out: [] };
  for (const name of keysOf(client.domains)) diffDomain(run, name);
  return run.out.sort(compareDeltas);
}

/**
 * Parse two `Protocol.js` sources and diff them.
 *
 * @param {string} clientText - playwright-core's `Protocol.js`.
 * @param {string} browserText - Camoufox's `Protocol.js`.
 * @returns {import('./juggler-diff.d.mts').IJugglerDelta[]} Every delta, deterministic.
 * @throws {import('./juggler-schema.mjs').UnparseableSchemaError} When either source is outside the grammar.
 */
export function diffProtocols(clientText, browserText) {
  return diffSchemas(parseJugglerSchema(clientText), parseJugglerSchema(browserText));
}
