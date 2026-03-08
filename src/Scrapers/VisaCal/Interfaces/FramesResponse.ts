import type { CardLevelFrame } from './CardLevelFrame.js';

export interface FramesResponse {
  result?: {
    bankIssuedCards?: {
      cardLevelFrames?: CardLevelFrame[];
    };
  };
}
