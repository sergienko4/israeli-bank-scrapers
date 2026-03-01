import * as SourceMap from 'source-map-support';

import { extendAsyncTimeout, getTestsConfig } from './TestsUtils';

SourceMap.install();
// Try to get test configuration object, no need to do anything beside that
getTestsConfig();
extendAsyncTimeout();
