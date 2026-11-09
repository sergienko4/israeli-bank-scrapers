/**
 * Phase names for the pipeline.
 * Every registered bank runs the API-direct chain: login, then scrape.
 */

/** The pipeline phases in execution order. */
type PhaseName = 'api-direct-call' | 'api-direct-scrape';

export default PhaseName;
