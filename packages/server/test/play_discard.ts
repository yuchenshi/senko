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

// tslint:disable-next-line:no-reference
/// <reference path='../node_modules/mocha-typescript/globals.d.ts' />
import * as firebase from '@firebase/testing';
import { GameState, PlayMove, DiscardMove } from 'senko-types';
import { RoomTestBase, MoveHelper } from './utils';

abstract class RemoveAndDrawTestBase<
  T extends PlayMove | DiscardMove
> extends RoomTestBase {
  // Creates a helper for current action. Used for testing different cases.
  abstract act(options?: { reveal?: boolean }): MoveHelper<T>;

  @test
  async 'should allow if everything is correct'() {
    const helper = this.act().draw();
    await firebase.assertSucceeds(helper.commit());
  }

  @test
  async 'should deny if deckTopCardId not updated'() {
    const helper = this.act().draw();
    helper.move = {
      ...helper.move,
      stateAfter: {
        ...helper.move.stateAfter,
        deckTopCardId: this.state().deckTopCardId, // Deck not updated.
      },
    };
    await firebase.assertFails(helper.commit());
  }

  @test
  async 'should deny if hand not updated'() {
    const helper = this.act().draw();
    helper.move = {
      ...helper.move,
      stateAfter: {
        ...helper.move.stateAfter,
        players: this.state().players, // Hand not updated.
      },
    };
    await firebase.assertFails(helper.commit());
  }

  @test
  async 'should deny if new card not drawn'() {
    const helper = this.act(); // No draw().
    await firebase.assertFails(helper.commit());
  }

  @test
  async 'should deny if old card not removed'() {
    const helper = this.act();
    const playersBeforeDraw = helper.move.stateAfter.players;
    helper.draw();
    helper.move = {
      ...helper.move,
      stateAfter: {
        ...helper.move.stateAfter,
        players: playersBeforeDraw, // Does not contain new card.
      },
    };
    await firebase.assertFails(helper.commit());
  }

  @test
  async 'should deny if move than one card removed from hand'() {
    const helper = this.act().draw();
    helper.removeFromHand(2);
    await firebase.assertFails(helper.commit());
  }

  @test
  async 'should allow hand size to decrease when deck is empty'() {
    // Make deck empty right after game start for testing.
    const totalCardCount = this.state().deckTopCardId;
    await this.adminRoom.update({
      'rules.totalCardCount': totalCardCount,
    });

    const helper = this.act(); // No draw().
    await firebase.assertSucceeds(helper.commit());
  }

  @test
  async 'should deny drawing when deck is empty'() {
    // Make deck empty right after game start for testing.
    const totalCardCount = this.state().deckTopCardId;
    await this.adminRoom.update({
      'rules.totalCardCount': totalCardCount,
    });

    const helper = this.act().draw(); // Try to draw -- which should fail.
    await firebase.assertFails(helper.commit());
  }

  @test
  async 'should deny updating deckTopCardId when deck is empty'() {
    // Make deck empty right after game start for testing.
    const totalCardCount = this.state().deckTopCardId;
    await this.adminRoom.update({
      'rules.totalCardCount': totalCardCount,
    });

    const helper = this.act(); // No draw().
    helper.move = {
      ...helper.move,
      stateAfter: {
        ...helper.move.stateAfter,
        deckTopCardId: totalCardCount + 1, // Try incrementing this.
      },
    };
    await firebase.assertFails(helper.commit());
  }

  @test
  async 'should deny moves once fuseCount becomes 0'() {
    await this.adminRoom
      .collection('moves')
      .doc('0')
      .update({
        'stateAfter.fuseCount': 0,
      });
    const helper = this.act().draw();
    helper.move = {
      ...helper.move,
      stateAfter: {
        ...helper.move.stateAfter,
        fuseCount: 0,
      },
    };
    await firebase.assertFails(helper.commit());
  }

  @test
  async 'should deny moves once all suits are at max rank'() {
    const helper = this.act().draw();
    const highestRanks = [4, 4, 4, 4, 4];
    await this.adminRoom
      .collection('moves')
      .doc('0')
      .update({
        'stateAfter.highestRanks': highestRanks,
      });
    helper.move = {
      ...helper.move,
      stateAfter: {
        ...helper.move,
        highestRanks,
      },
    };
    await firebase.assertFails(helper.commit());
  }

  // TODO: Test for deny when deck runs out + one final round.

  @test
  async 'should deny if the card is not revealed'() {
    const helper = this.act({ reveal: false }).draw();
    await firebase.assertFails(helper.commit());
  }

  @test
  async 'should deny if drawn card is not shown to others'() {
    const helper = this.act().draw(this.state().deckTopCardId, {
      showToOthers: false,
    });
    await firebase.assertFails(helper.commit());
  }
}

@suite
export class PlayMoveTestCases extends RemoveAndDrawTestBase<PlayMove> {
  act = this.play.bind(this, 0);

  @test
  async 'should deny player not in game to move'() {
    const helper = this.play(0).draw();

    const db = this.authedDb({ uid: 'mallory' }); // NOT in game.
    helper.roomRef = db.collection('rooms').doc(this.room.id);
    await firebase.assertFails(helper.commit());
  }

  @test
  async 'should deny non-turn player to make move'() {
    const cardId = this.state().players[1].hand[0];
    const move: PlayMove = {
      action: 'play',
      playerId: 1,
      cardId,
      stateAfter: this.state(),
    };
    const db = this.authedDb({ uid: 'bob' }); // NOT bob's turn.
    const roomRef = db.collection('rooms').doc(this.room.id);
    const helper = new MoveHelper(roomRef, this.getRoomData(), move, {
      playerId: 1,
    });
    helper
      .removeFromHand(cardId)
      .reveal(cardId)
      .draw();
    await firebase.assertFails(helper.commit());
  }

  @test
  async 'should deny player to make moves for others'() {
    const db = this.authedDb({ uid: 'bob' });
    const helper = this.play(0).draw();
    helper.roomRef = db.collection('rooms').doc(this.room.id);
    await firebase.assertFails(helper.commit());
  }

  @test
  async "should deny playing other's card"() {
    const cardId = 4; // In bob's hand.
    const helper = this.play(cardId).draw();
    await firebase.assertFails(helper.commit());
  }

  @test
  async 'should deny touching unrelated game state'() {
    const helper = this.play(0).draw();
    const wrongStates: GameState[] = [
      { ...helper.move.stateAfter, clockCount: 1 },
      { ...helper.move.stateAfter, fuseCount: 1 },
      { ...helper.move.stateAfter, highestRanks: [0, 0, 1, 0, 0] },
    ];
    for (const state of wrongStates) {
      helper.move = { ...helper.move, stateAfter: state };
      await firebase.assertFails(helper.commit());
    }
  }

  @test
  async 'should deny when trying to set a result at creation'() {
    const helper = this.play(0).draw();
    helper.move = { ...helper.move, result: 'success' };
    await firebase.assertFails(helper.commit());
  }

  @test
  async 'should deny when last play has not been resolved yet'() {
    const lastMoveHelper = this.play(0).draw();
    await lastMoveHelper.commit();

    const state = lastMoveHelper.move.stateAfter;
    const cardId = state.players[1].hand[0];
    const move: PlayMove = {
      action: 'play',
      playerId: 1,
      cardId,
      stateAfter: state,
    };
    const db = this.authedDb({ uid: 'bob' });
    const roomRef = db.collection('rooms').doc(this.room.id);
    const helper = new MoveHelper(roomRef, this.getRoomData(), move, {
      playerId: 1,
      moveId: 2,
    });
    helper
      .removeFromHand(cardId)
      .reveal(cardId)
      .draw();
    await firebase.assertFails(helper.commit());

    // Mark last move as resolved for testing. New move should now succeed.
    await this.adminRoom
      .collection('moves')
      .doc('1')
      .update({ result: 'success' });
    await firebase.assertSucceeds(helper.commit());
  }
}

@suite
export class DiscardMoveTestCases extends RemoveAndDrawTestBase<DiscardMove> {
  act = this.discard.bind(this, 0);

  @test
  async 'should deny if clockCount is at maxClockCount'() {
    const maxClockCount = this.getRoomData().rules.maxClockCount;
    await this.adminRoom
      .collection('moves')
      .doc('0')
      .update({
        'stateAfter.clockCount': maxClockCount,
      });
    const helper = this.act().draw();
    // No matter what the new clockCount is, this should not succeed.
    for (const clockCount of [maxClockCount, maxClockCount + 1]) {
      const move: DiscardMove = {
        ...helper.move,
        stateAfter: {
          ...helper.move.stateAfter,
          clockCount,
        },
      };
      helper.move = move;
      await firebase.assertFails(helper.commit());
    }
  }

  @test
  async 'should deny wrong updates to clockCount'() {
    for (const wrongClockCount of [
      this.state().clockCount,
      this.state().clockCount + 2,
    ]) {
      const helper = this.act().draw();
      const move: DiscardMove = {
        ...helper.move,
        stateAfter: {
          ...helper.move.stateAfter,
          clockCount: wrongClockCount,
        },
      };
      helper.move = move;
      await firebase.assertFails(helper.commit());
    }
  }

  @test
  async 'should deny touching unrelated game state'() {
    const helper = this.discard(0).draw();

    const move = helper.move;
    const wrongStates: GameState[] = [
      { ...move.stateAfter, fuseCount: 1 },
      { ...move.stateAfter, highestRanks: [0, 0, 1, 0, 0] },
    ];
    for (const state of wrongStates) {
      helper.move = { ...move, stateAfter: state };
      await firebase.assertFails(helper.commit());
    }
  }
}
