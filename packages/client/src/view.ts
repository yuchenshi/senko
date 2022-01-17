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

import { collection, doc } from 'rxfire/firestore';
import { Observable, combineLatest } from 'rxjs';
import { map, filter } from 'rxjs/operators';
import { DocumentReference, DocumentSnapshot } from '@firebase/firestore-types';

import {
  Room,
  Card,
  CardId,
  PlayerId,
  SuitId,
  RankId,
  Move,
  HintMove,
  GameState,
  Rules,
} from 'senko-types';

export interface Player {
  name: string;
  id: number;
  uid: string;
}

export interface IdAndData<T> {
  data: T;
  id: number;
}

export interface HintsForCard {
  cardId: CardId;
  matchingHints: IdAndData<HintMove>[];
  nonMatchingHints: IdAndData<HintMove>[];
  suit?: SuitId;
  rank?: RankId;
  suitWildForHints?: boolean;
  isExtraneous?: boolean;
  remainingCopies?: number;
}

export interface CardCopies {
  total: number;

  // Copies in score pile (i.e. successfully played; max: 1 in normal games).
  scorePile: number;

  // Copies in discard pile (including unsuccessful plays).
  discardPile: number;

  // Copies in hands and deck total (i.e. not in score / discard piles).
  remaining: number;
}

export interface CardInsights {
  // The card suit if revealed by a direct hint (e.g. "this card is Suit R").
  hintedSuit?: SuitId;

  // The card rank if revealed by a direct hint (e.g. "this card is Rank 1").
  hintedRank?: RankId;

  /**
   * Map from SuitId to true (i.e. eliminated by hints) or false.
   *
   * A suit is eliminated if a hint of that suit did not include this card.
   * Ex: if a player is given a hint that their left-most card is Suit R,
   * then their other cards cannot be Suit R (or they would have been included).
   *
   * Note: Only negative hints are considered. It does not consider positive
   * hints (see hintedSuit) or e.g. what cards are still left in this game.
   */
  isSuitEliminated: boolean[];

  /**
   * Map from RankId to true (i.e. eliminated by hints) or false.
   *
   * A rank is eliminated if a hint of that rank did not include this card.
   * Ex: if a player is given a hint that their left-most card is Rank 1,
   * then their other cards cannot be Rank 1 (or they would have been included).
   *
   * Note: Only negative hints are considered. It does not consider positive
   * hints (see hintedSuit) or e.g. what cards are still left in this game.
   */
  isRankEliminated: boolean[];
}

/**
 * Provides helper functions to observe the state of a game room.
 */
export class RoomView {
  private constructor(
    private roomDataObs: Observable<Room>,
    private movesObs: Observable<IdAndData<Move>[]>,
    private visibleCardsObs: Observable<Map<CardId, Card>>,
  ) {}

  /**
   * Get a view of a game room as seen by uid, by subscribing to snapshots for
   * the room DocumentReference (and its subcollections).
   *
   * The view will NOT contain card details that are not visible to uid.
   */
  public static create(room: DocumentReference, uid: string): RoomView {
    const roomDataObs = doc(room).pipe(map(snap => snap.data() as Room));
    const movesObs = collection(room.collection('moves')).pipe(
      filter(snaps => snaps.length > 0),
      map(snaps => {
        const list = snaps.map(snap => getIdAndData<Move>(snap));
        list.sort((a, b) => a.id - b.id);
        return list;
      }),
    );
    const revealedCardsQuery = room
      .collection('cards')
      .where('revealedByMoveId', '>=', 0);
    const visibleCardsQuery = room
      .collection('cards')
      .where('shownToUids', 'array-contains', uid);
    const visibleCardsObs = combineLatest(
      collection(revealedCardsQuery),
      collection(visibleCardsQuery),
    ).pipe(
      map(
        ([snaps1, snaps2]) =>
          new Map(
            snaps1
              .concat(snaps2)
              .map(
                snap => [parseInt(snap.id, 10), snap.data()] as [CardId, Card],
              ),
          ),
      ),
    );
    return new RoomView(roomDataObs, movesObs, visibleCardsObs);
  }

  discardedCardIds(): Observable<CardId[]> {
    return this.movesObs.pipe(
      map(moves => {
        const cardIds: CardId[] = [];
        moves.forEach(move => {
          if (
            move.data.action === 'discard' ||
            (move.data.action === 'play' && move.data.result === 'failure')
          ) {
            cardIds.push(move.data.cardId);
          }
        });
        return cardIds;
      }),
    );
  }

  playerUids(): Observable<string[]> {
    return this.roomDataObs.pipe(map(roomData => roomData.uidByPlayerId));
  }

  players(): Observable<Player[]> {
    return this.roomDataObs.pipe(
      map(roomData =>
        roomData.uidByPlayerId.map((uid, id) => {
          return { id, uid, name: roomData.playerNameById[id] };
        }),
      ),
    );
  }

  rules(): Observable<Rules> {
    return this.roomDataObs.pipe(map(roomData => roomData.rules));
  }

  visibleCards(): Observable<Map<CardId, Card>> {
    return this.visibleCardsObs;
  }

  lastMove(): Observable<IdAndData<Move>> {
    return this.movesObs.pipe(
      filter(moves => moves.length > 0),
      map(moves => moves[moves.length - 1]),
    );
  }

  // String summaries of events happened so far.
  eventLog({
    describeCard,
    describeHint,
  }: {
    describeCard: (card: Card | undefined) => string;
    describeHint: (hint: HintMove) => string;
  }): Observable<string[]> {
    return combineLatest([
      this.movesObs,
      this.roomDataObs,
      this.visibleCardsObs,
    ]).pipe(
      map(([moves, roomData, visibleCards]) => {
        const logs = moves.map(move => {
          const p0 = roomData.playerNameById[move.data.playerId];
          switch (move.data.action) {
            case 'init':
              return 'The game began.';
            case 'hint':
              const p1 = roomData.playerNameById[move.data.targetPlayerId];
              const hint = describeHint(move.data);
              return `${p0} pointed to all ${hint} in ${p1}'s hand.`;
            case 'play':
            case 'discard':
              const card = describeCard(visibleCards.get(move.data.cardId));
              if (move.data.action === 'discard') {
                return `${p0} discarded ${card}.`;
              } else {
                switch (move.data.result) {
                  case undefined:
                    return `${p0} is trying to play ${card}...`;
                  case 'success':
                    return `${p0} played ${card} successfully.`;
                  case 'failure':
                    return `${p0} tried to play ${card} but it did not work well.`;
                }
              }
          }
        });
        if (moves.length > 0) {
          const lastState = moves[moves.length - 1].data.stateAfter;
          if (lastState.fuseCount === 0) {
            logs.push('The game ended due to too many failed plays.');
          } else if (
            lastState.highestRanks.every(
              r => r === roomData.rules.rankCount - 1,
            )
          ) {
            logs.push('Congratulations! The game was perfect.');
          }
        }
        return logs;
      }),
    );
  }

  currentState(): Observable<GameState> {
    return this.lastMove().pipe(map(m => m.data.stateAfter));
  }

  currentPlayerId(): Observable<PlayerId> {
    return combineLatest([this.lastMove(), this.roomDataObs]).pipe(
      map(([move, roomData]) => {
        const lastPlayerId = move.data.playerId;
        return (lastPlayerId + 1) % roomData.uidByPlayerId.length;
      }),
    );
  }

  /**
   * Returns an observable of the details from cardIds. The returned Observable
   * will only emit value until all cards are visible and will continue to emit
   * with or without changes (e.g. card visibility updates).
   *
   * Generally, this should only be used on cards that are supposed to be
   * visible in this.visibleCards(), for example, this.discardedCardIds() or
   * cards in other player's hands.
   */
  toVisibleCards(cardIds: CardId[]): Observable<IdAndData<Card>[]> {
    return this.visibleCardsObs.pipe(
      map(visibleCards => {
        const result: IdAndData<Card>[] = [];
        for (const cardId of cardIds) {
          if (visibleCards.has(cardId)) {
            result.push({ id: cardId, data: visibleCards.get(cardId)! });
          } else {
            // This card does not exist in visibleCards. We will filter this
            // update out (with filter(notUndefined) below) and hopefully,
            // next visibleCards update will make the card available.
            return undefined;
          }
        }
        return result;
      }),
      filter(notUndefined),
    );
  }

  cardCopiesBySuitAndRank(): Observable<CardCopies[][]> {
    return combineLatest([
      this.movesObs,
      this.visibleCardsObs,
      this.rules(),
    ]).pipe(
      map(([moves, visibleCards, { suits }]) => {
        const results = [];
        for (const { copiesPerRank } of suits) {
          results.push(
            copiesPerRank.map(c => ({
              total: c,
              remaining: c,
              scorePile: 0,
              discardPile: 0,
            })),
          );
        }
        for (const move of moves) {
          if (move.data.action === 'play' || move.data.action === 'discard') {
            const revealedCard = visibleCards.get(move.data.cardId);
            if (revealedCard) {
              const { suit, rank } = revealedCard;
              const result = results[suit][rank];
              result.remaining -= 1;
              if (
                move.data.action === 'play' &&
                move.data.result === 'success'
              ) {
                result.scorePile += 1;
              } else {
                result.discardPile += 1;
              }
            }
          }
        }
        return results;
      }),
    );
  }

  hands(): Observable<HintsForCard[][]> {
    const hintMovesForCardIdObs = this.movesObs.pipe(
      map(moves => {
        const hintMoves = moves.filter(
          (move): move is IdAndData<HintMove> => move.data.action === 'hint',
        );
        return {
          matching: groupByMulti(hintMoves, move => move.data.matchingCardIds),
          nonMatching: groupByMulti(
            hintMoves,
            move => move.data.nonMatchingCardIds,
          ),
        };
      }),
    );
    return combineLatest([this.currentState(), hintMovesForCardIdObs]).pipe(
      map(([state, hintMovesForCardId]) => {
        return state.players.map(({ hand }) => {
          return hand
            .map(cardId => {
              return {
                cardId,
                matchingHints: hintMovesForCardId.matching.get(cardId) || [],
                nonMatchingHints:
                  hintMovesForCardId.nonMatching.get(cardId) || [],
              };
            })
            .sort((a, b) => a.cardId - b.cardId);
        });
      }),
    );
  }

  handsWithInsights(): Observable<(HintsForCard & CardInsights)[][]> {
    return combineLatest([
      this.rules(),
      this.hands(),
      this.visibleCardsObs,
      this.cardCopiesBySuitAndRank(),
    ]).pipe(
      map(
        ([
          { suitCount, rankCount },
          hands,
          visibleCards,
          copiesBySuitAndRank,
        ]) => {
          return hands.map(hand => {
            return hand.map(card => {
              let hintedSuit: SuitId | undefined = undefined;
              let hintedRank: RankId | undefined = undefined;
              const knownCard = visibleCards.get(card.cardId);
              let suitWildForHints: boolean | undefined =
                knownCard?.suitWildForHints;
              for (const hint of card.matchingHints) {
                if ('suit' in hint.data) {
                  if (
                    hintedSuit !== undefined &&
                    hintedSuit !== hint.data.suit
                  ) {
                    // Two conflicting hints! This must be a wild.
                    hintedSuit = suitCount - 1;
                    suitWildForHints = true;
                  } else {
                    hintedSuit = hint.data.suit;
                  }
                } else {
                  hintedRank = hint.data.rank;
                }
              }
              const isSuitEliminated = Array(suitCount).fill(false);
              const isRankEliminated = Array(rankCount).fill(false);
              for (const hint of card.nonMatchingHints) {
                if ('suit' in hint.data) {
                  isSuitEliminated[hint.data.suit] = true;
                } else {
                  isRankEliminated[hint.data.rank] = true;
                }
              }

              let remainingCopies = undefined;
              let isExtraneous = false;
              let suit = hintedSuit;
              let rank = hintedRank;
              if (knownCard) {
                suit = knownCard.suit;
                rank = knownCard.rank;
              }
              if (suit != null && rank != null) {
                const copies = copiesBySuitAndRank[suit][rank];
                remainingCopies = copies.remaining;
                if (copies.scorePile > 0) isExtraneous = true;
                if (remainingCopies <= 0) remainingCopies = undefined;
              } else if (rank === 4) {
                remainingCopies = 1; // TODO
              }
              return {
                ...card,
                hintedSuit,
                hintedRank,
                isSuitEliminated,
                isRankEliminated,
                suit,
                rank,
                suitWildForHints,
                remainingCopies,
                isExtraneous,
              };
            });
          });
        },
      ),
    );
  }
}

function getIdAndData<T>(snap: DocumentSnapshot): IdAndData<T> {
  return { id: parseInt(snap.id, 10), data: snap.data() as T };
}

function notUndefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function groupByMulti<K, V>(items: V[], keyFunc: (v: V) => K[]): Map<K, V[]> {
  const result = new Map<K, V[]>();
  for (const v of items) {
    for (const k of keyFunc(v)) {
      const list = result.get(k);
      if (list !== undefined) {
        list.push(v);
      } else {
        result.set(k, [v]);
      }
    }
  }
  return result;
}
