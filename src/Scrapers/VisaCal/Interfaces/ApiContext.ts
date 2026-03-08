import type moment from 'moment';

import type { FramesResponse } from './FramesResponse.js';

export interface ApiContext {
  startDate: Date;
  startMoment: moment.Moment;
  hdrs: Record<string, string>;
  frames: FramesResponse;
}
