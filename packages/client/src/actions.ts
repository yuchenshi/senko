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

import { Observable, Subscription, merge, combineLatest } from 'rxjs';
import {
  filter,
  map,
  distinctUntilKeyChanged,
  switchMap,
  first,
  withLatestFrom,
} from 'rxjs/operators';
import { DocumentReference, WriteBatch } from '@firebase/firestore-types';

import { RoomView, IdAndData } from './view';
import {
  CardId,
  PlayerId,
  PlayMove,
  Card,
  Rules,
  GameState,
  SuitId,
  HintMove,
  MoveId,
  Move,
  DiscardMove,
} from 'senko-types';

/**
 * Perform actions on behalf of playerUid by subscribing to view and actions.
 * The actions Observable can freely emit values. However, only one action will
 * be processed per turn. Excess actions & out-of-turn actions will be ignored.
 */
export function subscribeAndAct(
  view: RoomView,
  room: DocumentReference,
  playerUid: string,
  actions: Observable<Action>,
): Subscription {
  const acceptedActionsWithContext = combineLatest([
    view.lastMove(),
    view.playerUids(),
  ]).pipe(
    map(([lastMove, uids]) => {
      const myPlayerId = uids.indexOf(playerUid);
      const isMyTurn =
        myPlayerId === (lastMove.data.playerId + 1) % uids.length &&
        (lastMove.data.action !== 'play' || lastMove.data.result !== undefined);
      return { lastMove, myPlayerId, isMyTurn, uids };
    }),

    // This is not implemented using a simple distinct on move id because that
    // cannot handle cases where state is rolled back (e.g. network issues).
    distinctUntilKeyChanged('isMyTurn'),
    filter(data => data.isMyTurn),

    switchMap(({ lastMove, myPlayerId, uids }) =>
      actions.pipe(
        first(), // Accept only one action per turn.
        map(action => ({ action, lastMove, myPlayerId, uids })),
      ),
    ),
  );

  // Hints require a complete view of hand of targetPlayerId.
  const hints = acceptedActionsWithContext.pipe(
    filter(({ action }) => action.action === 'hint'),
    switchMap(({ action, lastMove, myPlayerId }) => {
      const hint = action as SuitHintAction | RankHintAction;
      const hand = lastMove.data.stateAfter.players[hint.targetPlayerId].hand;
      return view.toVisibleCards(hand).pipe(
        first(),
        map(cardsInHand => {
          return { hint, lastMove, myPlayerId, cardsInHand };
        }),
      );
    }),
    map(({ lastMove, hint, myPlayerId, cardsInHand }) => {
      const move = makeHintMove(
        lastMove.data.stateAfter,
        hint.targetPlayerId,
        cardsInHand,
        hint.field,
        hint.expected,
        myPlayerId,
      );
      const batch = makeWriteBatch(room, lastMove.id + 1, move);
      return { move, batch };
    }),
  );

  // These moves need rules but does not require visibleCards.
  const playOrDiscards = acceptedActionsWithContext.pipe(
    filter(
      ({ action }) => action.action === 'play' || action.action === 'discard',
    ),
    withLatestFrom(view.rules()),
    map(([{ action, lastMove, myPlayerId, uids }, rules]) => {
      const { action: act, cardId } = action as PlayAction | DiscardAction;
      const state = lastMove.data.stateAfter;
      const move = makeCardMove(state, rules, myPlayerId, act, cardId);
      const moveId = lastMove.id + 1;
      const batch = makeWriteBatch(room, moveId, move);

      // Reveal the card being played / discarded.
      batch.update(room.collection('cards').doc(cardId.toString()), {
        shownToUids: uids,
        revealedByMoveId: moveId,
      });

      if (state.deckTopCardId < rules.totalCardCount) {
        // If drawing a new card, make the card visible to everyone but self.
        batch.update(
          room.collection('cards').doc(state.deckTopCardId.toString()),
          {
            shownToUids: uids.filter(uid => uid !== playerUid),
            drawnByMoveId: moveId,
          },
        );
      }
      return { move, batch };
    }),
  );

  return merge(hints, playOrDiscards).subscribe(({ move, batch }) => {
    batch.commit().then(undefined, err => {
      // TODO: Better error reporting?
      // @ts-ignore to avoid strict lib dependency on Node.js or Browser.
      console.error('Unexpected error when making move', err, move);
    });
  });
}

/**
 * Perform reactions in room by subscribing to the view.
 */
export function subscribeAndReact(
  view: RoomView,
  room: DocumentReference,
): Subscription {
  const pendingMoves = view.lastMove().pipe(
    filter((move): move is IdAndData<PlayMove> => move.data.action === 'play'),
    filter(move => !move.data.result),
  );
  const pendingMovesWithContext = combineLatest([
    pendingMoves,
    view.visibleCards(),
    view.rules(),
  ]).pipe(
    // A Move can come before the card visibility change. To make reactions,
    // we need to wait until we see the card.
    filter(([move, visibleCards]) => visibleCards.has(move.data.cardId)),
  );
  return pendingMovesWithContext.subscribe(([move, visibleCards, rules]) => {
    const card = visibleCards.get(move.data.cardId)!;
    const updatePromise = room
      .collection('moves')
      .doc(move.id.toString())
      .update(makeReactionUpdate(move.data, card, rules));

    updatePromise.then(undefined, err => {
      if (err.code === 'permission-denied') {
        // Another client can react before us and then we will get permission
        // denied error for reacting again. It can be safely ignored.
        return;
      } else {
        // But other errors are probably real issues and should be logged.
        // @ts-ignore to avoid strict lib dependency on Node.js or Browser.
        console.error('Unexpected error when reacting', err, move);
      }
    });
  });
}

export type Action =
  | PlayAction
  | DiscardAction
  | SuitHintAction
  | RankHintAction;

export interface PlayAction {
  action: 'play';
  cardId: CardId;
}

export interface DiscardAction {
  action: 'discard';
  cardId: CardId;
}

export interface SuitHintAction {
  action: 'hint';
  targetPlayerId: PlayerId;
  field: 'suit';
  expected: SuitId;
}

export interface RankHintAction {
  action: 'hint';
  targetPlayerId: PlayerId;
  field: 'rank';
  expected: SuitId;
}

function makeCardMove(
  state: GameState,
  rules: Rules,
  myPlayerId: PlayerId,
  action: 'play' | 'discard',
  cardId: CardId,
): PlayMove | DiscardMove {
  const hand = state.players[myPlayerId].hand;
  const handAfter = hand.filter(c => c !== cardId);
  let deckTopCardIdAfter = state.deckTopCardId;
  if (state.deckTopCardId < rules.totalCardCount) {
    handAfter.push(state.deckTopCardId);
    deckTopCardIdAfter = state.deckTopCardId + 1;
  }

  const moveTemplate = {
    playerId: myPlayerId,
    cardId,
    stateAfter: {
      ...state,
      deckTopCardId: deckTopCardIdAfter,
      players: state.players.map((player, playerId) => {
        if (playerId !== myPlayerId) return player;
        return { hand: handAfter };
      }),
    },
  };

  if (action === 'play') {
    return { ...moveTemplate, action: action };
  } else {
    if (state.clockCount === rules.maxClockCount) {
      throw new Error('Cannot discard any card when at maxClockCount!');
    }
    return {
      ...moveTemplate,
      action: action,
      stateAfter: {
        ...moveTemplate.stateAfter,
        clockCount: state.clockCount + 1,
      },
    };
  }
}

function makeHintMove(
  state: GameState,
  targetPlayerId: PlayerId,
  targetHand: IdAndData<Card>[],
  field: 'rank' | 'suit',
  expected: number,
  myPlayerId: PlayerId,
): HintMove {
  if (state.clockCount === 0) {
    throw new Error('No hints left!');
  }
  const matchingCardIds: CardId[] = [];
  const nonMatchingCardIds: CardId[] = [];
  targetHand.forEach(card => {
    if (
      (field === 'suit' && card.data.suitWildForHints) ||
      card.data[field] === expected
    ) {
      matchingCardIds.push(card.id);
    } else {
      nonMatchingCardIds.push(card.id);
    }
  });
  if (matchingCardIds.length === 0) {
    throw new Error('Cannot give a hint not matching any cards!');
  }
  const moveTemplate = {
    action: 'hint' as 'hint',
    playerId: myPlayerId,
    targetPlayerId: targetPlayerId,
    matchingCardIds,
    nonMatchingCardIds,
    stateAfter: {
      ...state,
      clockCount: state.clockCount - 1,
    },
  };

  // Tell typescript to handle two types separately.
  if (field === 'rank') {
    return { ...moveTemplate, rank: expected };
  } else {
    return { ...moveTemplate, suit: expected };
  }
}

function makeWriteBatch(
  room: DocumentReference,
  moveId: MoveId,
  move: Move,
): WriteBatch {
  const batch = room.firestore.batch();
  batch.set(room.collection('moves').doc(moveId.toString()), move);
  return batch;
}

function makeReactionUpdate(move: PlayMove, card: Card, rules: Rules): object {
  let update;
  if (move.stateAfter.highestRanks[card.suit] + 1 === card.rank) {
    const highestRanks = move.stateAfter.highestRanks.concat([]);
    highestRanks[card.suit] += 1;
    let clockCount = move.stateAfter.clockCount;
    if (card.rank + 1 === rules.rankCount && clockCount < rules.maxClockCount) {
      clockCount += 1;
    }
    update = {
      result: 'success',
      'stateAfter.highestRanks': highestRanks,
      'stateAfter.clockCount': clockCount,
    };
  } else {
    update = {
      result: 'failure',
      'stateAfter.fuseCount': move.stateAfter.fuseCount - 1,
    };
  }
  return update;
}
