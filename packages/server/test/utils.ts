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

import * as fs from 'fs';
import {
  DocumentReference,
  FirebaseFirestore,
} from '@firebase/firestore-types';
import * as firebase from '@firebase/testing';
import {
  GameState,
  Room,
  Card,
  CardId,
  PlayMove,
  DiscardMove,
  MoveId,
  PlayerId,
} from 'senko-types';

export class FirebaseTestBase {
  static projectId = 'test-project';
  projectId = FirebaseTestBase.projectId;
  static rules = fs.readFileSync('firestore.rules', 'utf8');

  authedDb(auth: any): FirebaseFirestore {
    return firebase
      .initializeTestApp({ projectId: this.projectId, auth })
      .firestore();
  }

  adminDb(): FirebaseFirestore {
    return firebase
      .initializeAdminApp({ projectId: this.projectId })
      .firestore();
  }

  static async before() {
    await firebase.loadFirestoreRules({
      projectId: this.projectId,
      rules: this.rules,
    });
  }

  static async after() {
    await Promise.all(firebase.apps().map(app => app.delete()));
  }

  async before() {
    await firebase.clearFirestoreData({
      projectId: this.projectId,
    });
  }
}

export class MoveHelper<T extends PlayMove | DiscardMove> {
  cardUpdates = new Map<CardId, Partial<Card>>();
  private _moveId: MoveId;
  private _roomData: Room;
  private _playerId: PlayerId;

  constructor(
    public roomRef: DocumentReference,
    roomData: Room,
    public move: T,
    { moveId = 1, playerId = 0 }: { moveId?: MoveId; playerId?: PlayerId } = {},
  ) {
    this._moveId = moveId;
    this._roomData = roomData;
    this._playerId = playerId;
  }
  async commit(): Promise<DocumentReference> {
    const batch = this.roomRef.firestore.batch();
    const moveRef = this.roomRef
      .collection('moves')
      .doc(this._moveId.toString());
    batch.set(moveRef, this.move);

    for (const [cardId, update] of this.cardUpdates) {
      batch.update(
        this.roomRef.collection('cards').doc(cardId.toString()),
        update,
      );
    }
    await batch.commit();
    return moveRef;
  }
  removeFromHand(cardId: CardId): this {
    this.move = {
      ...this.move,
      stateAfter: {
        ...this.move.stateAfter,
        players: this.move.stateAfter.players.map(player => {
          return {
            hand: player.hand.filter(c => c !== cardId),
          };
        }),
      },
    };
    return this;
  }
  reveal(cardId: CardId): this {
    const uids = this._roomData.uidByPlayerId;
    this.cardUpdates.set(cardId, {
      shownToUids: uids,
      revealedByMoveId: this._moveId,
    });
    return this;
  }
  draw(
    cardId?: CardId,
    { showToOthers = true }: { showToOthers?: boolean } = {},
  ): this {
    const uids = this._roomData.uidByPlayerId;
    const cardToDraw =
      cardId !== undefined ? cardId : this.move.stateAfter.deckTopCardId;
    const playersAfter = this.move.stateAfter.players.map((player, pid) => {
      if (pid !== this._playerId) return player;
      return {
        hand: player.hand.concat([cardToDraw]),
      };
    });
    this.move = {
      ...this.move,
      stateAfter: {
        ...this.move.stateAfter,
        deckTopCardId: this.move.stateAfter.deckTopCardId + 1,
        players: playersAfter,
      },
    };
    if (showToOthers) {
      this.cardUpdates.set(cardToDraw, {
        shownToUids: uids.filter((_, pid) => pid !== this._playerId),
        drawnByMoveId: this._moveId,
      });
    }
    return this;
  }
}

export class RoomTestBase extends FirebaseTestBase {
  adminRoom!: DocumentReference;
  room!: DocumentReference;
  cards: Card[] = [
    // In alice's hands.
    { suit: 0, rank: 0, shownToUids: ['bob'], drawnByMoveId: 0 },
    { suit: 1, rank: 0, shownToUids: ['bob'], drawnByMoveId: 0 },
    { suit: 2, rank: 1, shownToUids: ['bob'], drawnByMoveId: 0 },
    { suit: 4, rank: 4, shownToUids: ['bob'], drawnByMoveId: 0 },

    // In bobs's hands.
    { suit: 2, rank: 2, shownToUids: ['alice'], drawnByMoveId: 0 },
    { suit: 3, rank: 2, shownToUids: ['alice'], drawnByMoveId: 0 },
    { suit: 2, rank: 3, shownToUids: ['alice'], drawnByMoveId: 0 },
    { suit: 3, rank: 4, shownToUids: ['alice'], drawnByMoveId: 0 },

    // Deck:
    { suit: 2, rank: 0, shownToUids: [] },
    { suit: 3, rank: 0, shownToUids: [] },
  ];

  async before() {
    await super.before();
    this.adminRoom = await this.adminDb()
      .collection('rooms')
      .doc('testRoom');
    await this.adminRoom.set(this.getRoomData());
    await this.adminRoom
      .collection('moves')
      .doc('0')
      .set({
        action: 'init',
        playerId: -1,
        stateAfter: this.state(),
      });
    await Promise.all(
      this.cards.map((card, index) => {
        return this.adminRoom
          .collection('cards')
          .doc(index.toString())
          .set(card);
      }),
    );
    this.room = this.authedDb({ uid: 'alice' })
      .collection('rooms')
      .doc(this.adminRoom.id);
  }

  getRoomData(): Room {
    return {
      playerIdByUid: {
        alice: 0,
        bob: 1,
      },
      uidByPlayerId: ['alice', 'bob'],
      playerNameById: ['Alice', 'Bob'],
      rules: {
        suits: [
          { copiesPerRank: [3, 2, 2, 2, 1], wildForHints: false },
          { copiesPerRank: [3, 2, 2, 2, 1], wildForHints: false },
          { copiesPerRank: [3, 2, 2, 2, 1], wildForHints: false },
          { copiesPerRank: [3, 2, 2, 2, 1], wildForHints: false },
          { copiesPerRank: [3, 2, 2, 2, 1], wildForHints: false },
        ],
        rankCount: 5,
        suitCount: 5,
        totalCardCount: 50,
        initFuseCount: 3,
        handSize: 4,
        maxClockCount: 8,
      },
    };
  }

  state(): GameState {
    return {
      // Do not set this to max to make testing discard / reaction easier.
      // To test corner cases at max, use adminRoom to overwrite this.
      clockCount: this.getRoomData().rules.maxClockCount - 1,

      fuseCount: this.getRoomData().rules.initFuseCount,
      deckTopCardId: 8,
      players: [{ hand: [0, 1, 2, 3] }, { hand: [4, 5, 6, 7] }],
      highestRanks: [-1, -1, -1, -1, -1],
    };
  }

  play(
    cardId: CardId,
    { reveal = true }: { reveal?: boolean } = {},
  ): MoveHelper<PlayMove> {
    const move: PlayMove = {
      action: 'play',
      playerId: 0,
      cardId,
      stateAfter: this.state(),
    };
    const helper = new MoveHelper(this.room, this.getRoomData(), move);
    helper.removeFromHand(cardId);
    if (reveal) {
      helper.reveal(cardId);
    }
    return helper;
  }

  discard(
    cardId: CardId,
    { reveal = true }: { reveal?: boolean } = {},
  ): MoveHelper<DiscardMove> {
    const move: DiscardMove = {
      action: 'discard',
      playerId: 0,
      cardId,
      stateAfter: {
        ...this.state(),
        clockCount: this.state().clockCount + 1,
      },
    };
    const helper = new MoveHelper(this.room, this.getRoomData(), move);
    helper.removeFromHand(cardId);
    if (reveal) {
      helper.reveal(cardId);
    }
    return helper;
  }
}
