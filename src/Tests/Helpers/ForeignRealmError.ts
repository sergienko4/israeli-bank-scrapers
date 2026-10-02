import * as vm from 'node:vm';

/**
 * Build an Error in a fresh V8 realm. Under Jest's ESM VM, Node's own socket
 * and timer errors look exactly like this: Error-branded, yet failing the test
 * realm's `instanceof Error`. Transports must still turn them into a failure.
 * @param message - The error message.
 * @returns The foreign-realm Error.
 */
export default function foreignRealmError(message: string): Error {
  const sandbox = { message };
  return vm.runInNewContext('new Error(message)', sandbox) as Error;
}
