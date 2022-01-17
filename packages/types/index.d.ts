/*
  Copyright 2019 Yuchen Shi

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

export type int = number;
export type CardId = int;
export type PlayerId = int;
export type SuitId = int;
export type RankId = int;
export type MoveId = int;

export interface PlayerState {
  hand: CardId[];
}

export interface GameState {
  clockCount: int;
  fuseCount: int;
  deckTopCardId: CardId;
  players: PlayerState[];
  highestRanks: int[];
}

interface BaseMove {
  action: string;
  playerId: PlayerId;
  stateAfter: GameState;
}

export interface InitMove extends BaseMove {
  action: 'init';
  playerId: -1;
}

export interface PlayMove extends BaseMove {
  action: 'play';
  cardId: CardId;
  result?: 'success' | 'failure';
}

export interface DiscardMove extends BaseMove {
  action: 'discard';
  cardId: CardId;
}

export interface BaseHintMove extends BaseMove {
  action: 'hint';
  targetPlayerId: PlayerId;
  matchingCardIds: CardId[];
  nonMatchingCardIds: CardId[];
}

export interface SuitHintMove extends BaseHintMove {
  suit: SuitId;
}

export interface RankHintMove extends BaseHintMove {
  rank: RankId;
}

export type HintMove = SuitHintMove | RankHintMove;
export type Move = InitMove | PlayMove | DiscardMove | HintMove;

export interface Room {
  playerIdByUid: { [uid: string]: PlayerId };
  uidByPlayerId: string[];
  playerNameById: string[];
  rules: Rules;
}

export interface Rules {
  rankCount: int;
  suitCount: int;
  totalCardCount: int;
  maxClockCount: int;
  initFuseCount: int;
  handSize: int;
  suits: {
    wildForHints: boolean;
    copiesPerRank: int[];
  }[];
}

export interface Card {
  suit: SuitId;
  rank: RankId;
  shownToUids: string[];
  drawnByMoveId?: MoveId;
  revealedByMoveId?: MoveId;
  suitWildForHints?: boolean;
}
