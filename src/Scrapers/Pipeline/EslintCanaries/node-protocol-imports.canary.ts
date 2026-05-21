/**
 * Canary — closes spec.txt §1 RC-9 (`typescript:S7772`).
 *
 * <p>Verifies the `unicorn/prefer-node-protocol` rule fires on
 * a Node built-in import that omits the `node:` prefix. The
 * prefix distinguishes the built-in from any third-party npm package
 * that could shadow it (an `events` package exists separately
 * on npm).
 *
 * <p>Applicable guidelines (per spec.txt §1 RC-9):
 * <ul>
 *   <li>`coding-principle-guidlines.md` — defensive coding,
 *       explicit dependencies.</li>
 *   <li>`dependency-updates-guidlines.md` — distinguish core
 *       vs third-party.</li>
 * </ul>
 */

// Deliberate violation — built-in import without `node:` prefix.
import { EventEmitter } from 'events';

/**
 * Construct an EventEmitter so the import is not tree-shaken before
 * the lint pass reaches it.
 * @returns A new `EventEmitter` instance.
 */
function buildEmitter(): EventEmitter {
  return new EventEmitter();
}

export { buildEmitter };
