import { CompanyTypes } from '../../Definitions.js';
import { type ILoginConfig } from '../Base/Config/LoginConfig.js';
import { BEHATSDAA_CONFIG } from '../Behatsdaa/Config/BehatsdaaLoginConfig.js';
import { BEYAHAD_CONFIG } from '../BeyahadBishvilha/Config/BeyahadBishvilhaLoginConfig.js';
import LEUMI_CONFIG from '../Leumi/Config/LeumiLoginConfig.js';
import { MIZRAHI_CONFIG } from '../Mizrahi/Config/MizrahiLoginConfig.js';
import { YAHAV_CONFIG } from '../Yahav/Config/YahavLoginConfig.js';

/** Registry mapping CompanyTypes to their declarative login configurations. */
const BANK_REGISTRY: Partial<Record<CompanyTypes, ILoginConfig>> = {
  [CompanyTypes.Leumi]: LEUMI_CONFIG,
  [CompanyTypes.Mizrahi]: MIZRAHI_CONFIG,
  [CompanyTypes.Behatsdaa]: BEHATSDAA_CONFIG,
  [CompanyTypes.BeyahadBishvilha]: BEYAHAD_CONFIG,
  [CompanyTypes.Yahav]: YAHAV_CONFIG,
};

export { BANK_REGISTRY };
export default BANK_REGISTRY;
