/**
 * SealKinds — the seal algorithm each `SealKind` names (N10). A new kind is
 * one entry here and one in the build-time kind rule; the step wiring reads
 * only this map.
 */

import type { Procedure } from '../../../Types/Procedure.js';
import type { SealKind } from '../ConfigContracts/index.js';
import { type ISealInput, sealRsaBlockXor } from './SealRsaBlockXor.js';

/** Seals one source; failures name no value. */
type Sealer = (input: ISealInput) => Procedure<string>;

/** The sealer of every seal kind. */
const SEALERS: Readonly<Record<SealKind, Sealer>> = {
  'rsa-pkcs1-block-xor': sealRsaBlockXor,
};

export type { Sealer };
export { SEALERS };
