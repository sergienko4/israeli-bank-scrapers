/**
 * The FIBI-group brands' headless blocks, re-exported as one module so the
 * bank registry takes the whole group in a single import. Each block is
 * built in its brand's own config module from the shared FIBI-family login.
 */

export { BEINLEUMI_TRANSPORT } from './PipelineBankConfigBeinleumi.js';
export { MASSAD_TRANSPORT } from './PipelineBankConfigMassad.js';
export { OTSAR_HAHAYAL_TRANSPORT } from './PipelineBankConfigOtsarHahayal.js';
export { PAGI_TRANSPORT } from './PipelineBankConfigPagi.js';
