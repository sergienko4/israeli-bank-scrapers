/**
 * SealKinds — the planner each `SealKind` names. A planner reads
 * its refs through the step's resolver and returns the body writes it seals;
 * a new kind is one entry here and one in the build-time kind rule, and the
 * step wiring reads only `planSeal`.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import type {
  ISealFieldConfig,
  ISealRsaBlockXorConfig,
  SealKind,
} from '../ConfigContracts/index.js';
import type { SealPlan, SealRefText } from './SealPlan.js';
import { sealRsaBlockXor } from './SealRsaBlockXor.js';
import { planRsaPkcs1 } from './SealRsaPkcs1.js';
import { SOURCE_INVALID } from './SealTail.js';

/** Plans the writes of one seal kind. */
type SealPlanner<TKind extends SealKind> = (
  seal: Extract<ISealFieldConfig, { readonly kind: TKind }>,
  refText: SealRefText,
) => SealPlan;

/**
 * Plan an `rsa-pkcs1-block-xor` seal: one write at its `writeTo`.
 * @param seal - Seal config.
 * @param refText - Ref reader.
 * @returns The single write, or a failure that names no value.
 */
function planBlockXor(seal: ISealRsaBlockXorConfig, refText: SealRefText): SealPlan {
  const modulusHex = refText(seal.modulusRef);
  if (modulusHex === false) return fail(ScraperErrorTypes.Generic, 'seal key invalid');
  const source = refText(seal.sourceRef);
  if (source === false) return fail(ScraperErrorTypes.Generic, SOURCE_INVALID);
  const sealed = sealRsaBlockXor({ source, modulusHex, params: seal.params });
  if (!isOk(sealed)) return sealed;
  return succeed([{ writeTo: seal.writeTo, value: sealed.value }]);
}

/** The planner of every seal kind. */
const SEAL_PLANNERS: { readonly [TKind in SealKind]: SealPlanner<TKind> } = {
  'rsa-pkcs1-block-xor': planBlockXor,
  'rsa-pkcs1-v15': planRsaPkcs1,
};

/**
 * Plan a step's seal with the planner its kind names.
 * @param seal - Seal config.
 * @param refText - Ref reader.
 * @returns The body writes, or a failure that names no value.
 */
function planSeal(seal: ISealFieldConfig, refText: SealRefText): SealPlan {
  const planner = SEAL_PLANNERS[seal.kind] as (
    seal: ISealFieldConfig,
    refText: SealRefText,
  ) => SealPlan;
  return planner(seal, refText);
}

export default planSeal;
export { planSeal };
