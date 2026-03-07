import type { ICardLevelFrame } from './CardLevelFrame';

export interface IFramesResponse {
  result?: {
    bankIssuedCards?: {
      cardLevelFrames?: ICardLevelFrame[];
    };
  };
}
