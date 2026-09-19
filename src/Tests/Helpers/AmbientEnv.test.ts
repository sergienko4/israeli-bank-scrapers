/**
 * AmbientEnv round-trip — a restore has to be faithful in both directions.
 *
 * <p>These pin the two ways an environment restore goes wrong: inventing a
 * value for a variable the host never set, and discarding one it did set.
 * The second is not hypothetical — `E2eRealTokenCacheMode.test.ts` deleted
 * `ONEZERO_OTP_LONG_TERM` unconditionally, which erased the flag a developer
 * really does carry in `.env` for every later test in the same worker.
 */

import { captureEnvVar, restoreEnvVar } from './AmbientEnv.js';

/** Variable name used for the probes — never read by production code. */
const PROBE = 'AMBIENT_ENV_PROBE_VAR';

/** What the imaginary host had before a probe ran. */
const HOST_VALUE = 'value-the-host-had';

/** What a probe overwrites the variable with mid-test. */
const PROBE_VALUE = 'value-the-probe-set';

afterEach((): boolean => {
  Reflect.deleteProperty(process.env, PROBE);
  return true;
});

describe('AmbientEnv — restoring a variable the host had set', () => {
  it('puts the original value back, rather than dropping the variable', () => {
    process.env[PROBE] = HOST_VALUE;
    const captured = captureEnvVar(PROBE);
    process.env[PROBE] = PROBE_VALUE;
    restoreEnvVar(captured);
    expect(process.env[PROBE]).toBe(HOST_VALUE);
  });

  it('captures the value at capture time, not at restore time', () => {
    process.env[PROBE] = HOST_VALUE;
    const captured = captureEnvVar(PROBE);
    expect(captured.value).toBe(HOST_VALUE);
  });
});

describe('AmbientEnv — restoring a variable the host never set', () => {
  it('leaves the variable absent, rather than inventing an empty value', () => {
    Reflect.deleteProperty(process.env, PROBE);
    const captured = captureEnvVar(PROBE);
    process.env[PROBE] = PROBE_VALUE;
    restoreEnvVar(captured);
    expect(PROBE in process.env).toBe(false);
  });

  it('records the absence as undefined', () => {
    Reflect.deleteProperty(process.env, PROBE);
    const captured = captureEnvVar(PROBE);
    expect(captured.value).toBeUndefined();
  });
});
