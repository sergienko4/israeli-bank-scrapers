// Config for `npm run test:pipeline` only: jest.pipeline.config.cjs plus a
// worker count that CI can raise through JEST_MAX_WORKERS. The default stays
// 2, so local runs and the hooks behave as before.
//
// This is a separate file because `test:memory` also reads
// jest.pipeline.config.cjs and sets no --maxWorkers. A default there would
// change the Memory gate's workload and skew its HEAD-vs-base comparison.

const base = require('./jest.pipeline.config.cjs');

const workers = process.env.JEST_MAX_WORKERS ?? '2';

// Jest itself turns an unparseable value into 1 worker without a word
// (jest-config `parseWorkers`), so a typo would quietly serialise the suite.
if (!/^(?:[1-9]\d*|(?:100|[1-9]\d?)%)$/.test(workers)) {
  throw new Error(`JEST_MAX_WORKERS must be a positive integer or 1-100%, got "${workers}"`);
}

module.exports = { ...base, maxWorkers: workers };
