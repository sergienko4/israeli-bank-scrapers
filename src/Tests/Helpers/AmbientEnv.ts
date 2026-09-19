/**
 * AmbientEnv — capture and reinstate a single environment variable around a
 * probe that has to change it.
 *
 * <p>The mirror of {@link ./AmbientZone.ts}, and it exists for the same
 * reason. A restore is lossy in *both* directions: reading through a `??`
 * fallback invents a value the host never had, and deleting unconditionally
 * throws away one the host did have. Either way the variable leaks into every
 * later test in the same worker. Capturing the raw `string | undefined` and
 * branching on `undefined` is the only faithful round trip.
 */

/** One environment variable exactly as the host had it. */
export interface ICapturedEnvVar {
  /** Variable name. */
  readonly name: string;
  /** Raw value, or `undefined` when the host never set it. */
  readonly value: string | undefined;
}

/**
 * Read a variable as it stands, without substituting a default.
 * @param name - Variable to capture.
 * @returns The captured variable, `value` absent when it was never set.
 */
export function captureEnvVar(name: string): ICapturedEnvVar {
  return { name, value: process.env[name] };
}

/**
 * Put a variable back exactly as {@link captureEnvVar} found it, including
 * restoring it to *absent* when it started absent.
 * @param previous - The variable to reinstate.
 * @returns The variable that was reinstated.
 */
export function restoreEnvVar(previous: ICapturedEnvVar): ICapturedEnvVar {
  if (previous.value === undefined) Reflect.deleteProperty(process.env, previous.name);
  else process.env[previous.name] = previous.value;
  return previous;
}
