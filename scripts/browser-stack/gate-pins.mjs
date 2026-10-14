/**
 * Pinned `Protocol.js` digests of `browser-stack.json`, checked before the
 * gate parses a byte.
 *
 * A raw.githubusercontent.com tag URL serves whatever the tag points at now,
 * and a tag can be moved. `playwrightCore.protocolSha256` pins the client file
 * per exact version; `camoufox.protocolSha256` pins the browser file of
 * `camoufox.tag`, and moves with it. Per side the fetched bytes are:
 *
 * - match — the pinned bytes;
 * - unpinned — no pin covers the version or tag: reported `[info]`, never fails;
 * - mismatch — gate mode stops with DIGEST-MISMATCH (exit 2) before parsing;
 *   candidate mode reports it `[info]`.
 */
import { GateInfraError } from './gate-inputs.mjs';
import { sideName, stopsOnMismatch } from './gate-report.mjs';

/**
 * @typedef {import('./gate-inputs.mjs').Manifest} Manifest
 * @typedef {import('./gate-report.mjs').PinState} PinState
 * @typedef {{ manifest: Manifest, playwright: string, camoufox: string }} Pair
 * @typedef {{ client: string, browser: string }} Digests - One sha256 per side.
 */

/** Both sides, client first: the order of report rows and error lines. */
const SIDES = /** @type {const} */ (['client', 'browser']);

/**
 * The pinned digest of each side; '' where no pin covers it.
 *
 * @param {Pair} pair - Manifest and the pair under test.
 * @returns {Digests} Pinned digests.
 */
function pinsOf({ manifest, playwright, camoufox }) {
  const versions = manifest.playwrightCore.protocolSha256;
  const client = Object.hasOwn(versions, playwright) ? versions[playwright] : '';
  const browser = camoufox === manifest.camoufox.tag ? manifest.camoufox.protocolSha256 : '';
  return { client, browser };
}

/** @type {(got: string, pinned: string) => PinState} One side against its pin. */
const stateOf = (got, pinned) => {
  if (pinned === '') return 'unpinned';
  return got === pinned ? 'match' : 'mismatch';
};

/**
 * Each side against its pin; in a mode that stops on a mismatch, DIGEST-MISMATCH instead.
 *
 * @param {Pair} pair - Manifest and the pair under test.
 * @param {string} mode - `--mode`.
 * @param {Digests} sha256 - Digests of the fetched bodies.
 * @returns {{ client: PinState, browser: PinState }} Pin states.
 * @throws {GateInfraError} DIGEST-MISMATCH, one line per moved side, when `mode` stops on it.
 */
export function checkPins(pair, mode, sha256) {
  const pinned = pinsOf(pair);
  const states = {
    client: stateOf(sha256.client, pinned.client),
    browser: stateOf(sha256.browser, pinned.browser),
  };
  const moved = SIDES.filter(side => states[side] === 'mismatch');
  if (moved.length === 0 || !stopsOnMismatch(mode)) return states;
  const line = (/** @type {'client' | 'browser'} */ side) =>
    `DIGEST-MISMATCH ${sideName(pair, side)} sha256=${sha256[side]} pinned=${pinned[side]}`;
  throw new GateInfraError(moved.map(line));
}
