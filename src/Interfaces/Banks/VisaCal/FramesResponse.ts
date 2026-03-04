import type { CardLevelFrame } from './CardLevelFrame';

export interface FramesResponse {
  result?: {
    bankIssuedCards?: {
      cardLevelFrames?: CardLevelFrame[];
    };
  };
}
