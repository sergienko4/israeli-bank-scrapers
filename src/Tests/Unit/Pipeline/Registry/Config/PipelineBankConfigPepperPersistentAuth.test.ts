/**
 * Pepper durable-auth config oracles.
 *
 * Renewal must reach a fresh JWT on an already-bound device through exactly
 * `/auth/login` then one password assertion. These tests pin that data so a
 * config edit cannot silently re-introduce bind, an OTP method or a pre-hook
 * into the resume path, and pin the selectors the live proof depends on.
 *
 * Dynamic import dodges the no-restricted-imports DI rule that bans static
 * imports of Registry/Config/** in Pipeline tests.
 */

import type {
  IApiDirectCallConfig,
  IPersistentAuthConfig,
  IStepConfig,
} from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';

/** Module shape of the Pepper call-config literal. */
interface IPepperConfigModule {
  readonly default: IApiDirectCallConfig;
}

/** Expected login selectors — pinned to the protocol reference. */
const LOGIN_SELECTORS = {
  challenge: '/data/challenge',
  pwdAction: '/data/control_flow/0/type',
  pwdAssertionId: '/data/control_flow/0/methods/?type=password/assertion_id',
  sessionId: '/headers/*session_id',
};

/** Signed password-assertion body key order — the signature covers it. */
const ASSERT_DATA_KEYS = ['action', 'assert', 'assertion_id', 'fch', 'data', 'method'];

/** Flow-stable client-instance reference used as Pepper's `CellPhoneID`. */
const CLIENT_INSTANCE_REF = { $ref: 'carry.clientInstanceId' };

/**
 * Load the Pepper call-config literal.
 * @returns Pepper IApiDirectCallConfig.
 */
async function loadPepper(): Promise<IApiDirectCallConfig> {
  const path = '../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigPepper.js';
  const mod = (await import(path)) as IPepperConfigModule;
  return mod.default;
}

/**
 * Load Pepper's persistent-auth block, failing the test when it is absent.
 * @returns The declared block.
 */
async function loadPersistent(): Promise<IPersistentAuthConfig> {
  const config = await loadPepper();
  const block = config.persistentAuth;
  if (block === undefined) throw new TypeError('Pepper declares no persistentAuth block');
  return block;
}

/**
 * Read a nested JSON-template node by key path.
 * @param root - Template root.
 * @param keys - Key path to walk.
 * @returns The node at the path.
 */
function nodeAt(root: unknown, keys: readonly string[]): unknown {
  return keys.reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], root);
}

/**
 * Resume step at an index, failing the test when it is absent.
 * @param block - Persistent-auth block.
 * @param index - Step index.
 * @returns The resume step.
 */
function resumeStep(block: IPersistentAuthConfig, index: number): IStepConfig {
  const step = block.resumeSteps.at(index);
  if (step === undefined) throw new TypeError(`no resume step at ${String(index)}`);
  return step;
}

describe('Pepper persistent auth — enrollment', () => {
  it('keeps the legacy bind → password → OTP ordering', async () => {
    const config = await loadPepper();
    const names = config.steps.map(step => step.name);
    expect(names).toEqual(['bind', 'assertPassword', 'assertOtp']);
  });

  it('binds with the flow-stable client instance id as CellPhoneID', async () => {
    const config = await loadPepper();
    const params = nodeAt(config.steps[0].body.shape, ['data', 'params']);
    expect(params).toHaveProperty('CellPhoneID', CLIENT_INSTANCE_REF);
    expect(params).toHaveProperty('transactionId', { $ref: 'uuid' });
  });

  it('seeds the client instance id once per flow from a random UUID', async () => {
    const config = await loadPepper();
    const block = await loadPersistent();
    const seed = { field: block.clientInstanceIdField, bootstrap: { kind: 'random-uuid' } };
    expect(config.seedCarryFromCreds).toContainEqual(seed);
  });

  it('extracts the device id the persisted state is bound to', async () => {
    const config = await loadPepper();
    const block = await loadPersistent();
    expect(config.steps[0].extractsToCarry).toHaveProperty(block.deviceIdField);
  });
});

describe('Pepper persistent auth — block', () => {
  it('declares the provider, identity fields and freshness margin', async () => {
    const block = await loadPersistent();
    const { resumeSteps, ...scalars } = block;
    expect(resumeSteps).toHaveLength(2);
    expect(scalars).toEqual({
      provider: 'pepper',
      clientInstanceIdField: 'clientInstanceId',
      deviceIdField: 'deviceId',
      accountField: 'phoneNumber',
      freshnessMarginSeconds: 300,
    });
  });
});

describe('Pepper persistent auth — resume steps', () => {
  it('runs exactly /auth/login then /auth/assert', async () => {
    const block = await loadPersistent();
    const tags = block.resumeSteps.map(step => step.urlTag);
    expect(tags).toEqual(['auth.login', 'auth.assert']);
  });

  it('declares no pre-hook, so no step can wait for an OTP', async () => {
    const block = await loadPersistent();
    const hooked = block.resumeSteps.filter(step => step.preHook !== undefined);
    expect(hooked).toEqual([]);
  });

  it('never references an OTP field, method or carry slot', async () => {
    const block = await loadPersistent();
    const serialized = JSON.stringify(block.resumeSteps);
    expect(serialized).not.toMatch(/otp/i);
  });

  it('logs in on the persisted device without a session id', async () => {
    const block = await loadPersistent();
    const query = resumeStep(block, 0).queryTemplate;
    expect(query).toHaveProperty('did', { $ref: 'carry.deviceId' });
    expect(query).not.toHaveProperty('sid');
  });

  it('logs in with the same client instance id enrollment bound', async () => {
    const block = await loadPersistent();
    const shape = resumeStep(block, 0).body.shape;
    const params = nodeAt(shape, ['data', 'params']);
    const policy = nodeAt(shape, ['data', 'policy_request_id']);
    expect(params).toHaveProperty('CellPhoneID', CLIENT_INSTANCE_REF);
    expect(policy).toEqual({ $literal: 'default' });
  });

  it('extracts the dynamic action, password assertion, session and challenge', async () => {
    const block = await loadPersistent();
    expect(resumeStep(block, 0).extractsToCarry).toEqual(LOGIN_SELECTORS);
  });

  it('asserts the password under the server-selected action', async () => {
    const block = await loadPersistent();
    const data = nodeAt(resumeStep(block, 1).body.shape, ['data']);
    const keys = Object.keys(data as object);
    expect(keys).toEqual(ASSERT_DATA_KEYS);
    expect(data).toHaveProperty('action', { $ref: 'carry.pwdAction' });
    expect(data).toHaveProperty('method', { $literal: 'password' });
  });

  it('ends holding only the replacement access token', async () => {
    const block = await loadPersistent();
    expect(resumeStep(block, 1).extractsToCarry).toEqual({ token: '/data/token' });
  });
});
