import type { Frame } from 'playwright';

export interface IOtpFillOpts {
  frame: Frame;
  sel: string;
  el: Awaited<ReturnType<Frame['$']>>;
  code: string;
}
