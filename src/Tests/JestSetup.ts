import * as SourceMap from 'source-map-support';

import { SCRAPE_TIMEOUT } from './Config/TestTimingConfig.js';
import { extendAsyncTimeout, getTestsConfig } from './TestsUtils.js';

// NB: production runs load .env (real-E2E tests call dotenv.config()
// per-file) so PII_REDACTION=off is honored at gate-7 time. Unit tests
// run with PII_REDACTION default-on so PiiRedactor.test.ts and other
// strategy tests can assert the masked-output contract.
SourceMap.install();
// Try to get test configuration object, no need to do anything beside that
getTestsConfig();
// SCRAPE_TIMEOUT (8 min) is the ceiling for live-E2E tests; per-test
// `jest.setTimeout()` in beforeAll doesn't override default reliably,
// so we set it at the global setup level.
extendAsyncTimeout(SCRAPE_TIMEOUT);
