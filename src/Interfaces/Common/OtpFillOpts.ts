import type { Frame } from 'playwright';

export interface OtpFillOpts {
  frame: Frame;
  sel: string;
  el: Awaited<ReturnType<Frame['$']>>;
  code: string;
}
