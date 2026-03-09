import type { ICardLevelFrame } from './CardLevelFrame.js';

export interface IFramesResponse {
  result?: {
    bankIssuedCards?: {
      cardLevelFrames?: ICardLevelFrame[];
    };
  };
}
