import type moment from 'moment';

import type { IFramesResponse } from './FramesResponse';

export interface IApiContext {
  startDate: Date;
  startMoment: moment.Moment;
  hdrs: Record<string, string>;
  frames: IFramesResponse;
}
