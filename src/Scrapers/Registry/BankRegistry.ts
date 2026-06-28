import { CompanyTypes } from '../../Definitions.js';
import { type ILoginConfig } from '../Base/Config/LoginConfig.js';
import { BEHATSDAA_CONFIG } from '../Behatsdaa/Config/BehatsdaaLoginConfig.js';
import { BEYAHAD_CONFIG } from '../BeyahadBishvilha/Config/BeyahadBishvilhaLoginConfig.js';
import { MIZRAHI_CONFIG } from '../Mizrahi/Config/MizrahiLoginConfig.js';

/** Registry mapping CompanyTypes to their declarative login configurations. */
const BANK_REGISTRY: Partial<Record<CompanyTypes, ILoginConfig>> = {
  [CompanyTypes.Mizrahi]: MIZRAHI_CONFIG,
  [CompanyTypes.Behatsdaa]: BEHATSDAA_CONFIG,
  [CompanyTypes.BeyahadBishvilha]: BEYAHAD_CONFIG,
};

export { BANK_REGISTRY };
export default BANK_REGISTRY;
