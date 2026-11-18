/**
 * PayBox warm-token bootstrap: a published `v1.` envelope must yield the
 * inner JWT's `pl.uId`, and an unusable stored token must let the cold login
 * proceed because the `uId` bootstrap is optional.
 */

import type { IApiDirectCallConfig } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import buildInitialCarry from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/Lifecycle/FlowInitCarry.build.js';
import { encodeRawCarry } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/WarmRawCarry.js';
import { carryWarmOf } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/WarmStartKind.js';
import { assertOk } from '../../../../Helpers/AssertProcedure.js';
import { callOfModule } from '../../../../Helpers/BankConfigModule.js';
import { makeJwtExpiringInWithClaims } from '../../../../Helpers/Jwt.js';

const CALL_PATH = '../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigPayBox.js';
const PHONE = '972500000000';
const UID = 'syn-paybox-uId';

/**
 * Load the PayBox call config.
 * @returns The config literal.
 */
async function loadCall(): Promise<IApiDirectCallConfig> {
  const mod = (await import(CALL_PATH)) as Record<string, unknown>;
  return callOfModule(mod);
}

/**
 * The raw JWT a warm PayBox run carries inside its envelope.
 * @returns Compact JWT with the `pl.uId` claim.
 */
function warmJwt(): string {
  return makeJwtExpiringInWithClaims(3600, { pl: { uId: UID } });
}

/**
 * Wrap a raw JWT in the config's PayBox envelope.
 * @param config - PayBox call config.
 * @param raw - Raw JWT.
 * @returns The envelope token.
 */
function wrap(config: IApiDirectCallConfig, raw: string): string {
  const warm = carryWarmOf(config);
  if (warm === false || warm.provider === undefined || warm.accountFields === undefined) {
    throw new RangeError('PayBox warm start is not bound');
  }
  const token = encodeRawCarry(
    { provider: warm.provider, accounts: [PHONE], tagKey: warm.accountTagKey ?? '' },
    raw,
  );
  assertOk(token);
  return token.value;
}

describe('PayBox warm-token bootstrap', () => {
  it('reads uId from the JWT inside a published envelope', async () => {
    const config = await loadCall();
    const jwt = warmJwt();
    const token = wrap(config, jwt);
    const carry = buildInitialCarry(config, { phoneNumber: PHONE, otpLongTermToken: token }, {});
    assertOk(carry);
    expect(carry.value.uId).toBe(UID);
  });

  it('reads uId from a legacy raw JWT', async () => {
    const config = await loadCall();
    const carry = buildInitialCarry(
      config,
      { phoneNumber: PHONE, otpLongTermToken: warmJwt() },
      {},
    );
    assertOk(carry);
    expect(carry.value.uId).toBe(UID);
  });

  it('keeps the cold path open when the stored token is unusable', async () => {
    const config = await loadCall();
    const carry = buildInitialCarry(
      config,
      { phoneNumber: PHONE, otpLongTermToken: 'v1.not-a-json-body' },
      {},
    );
    assertOk(carry);
    expect(carry.value.uId).toBe('');
  });
});
