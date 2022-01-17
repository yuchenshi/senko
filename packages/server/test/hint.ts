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
import { HintMove, GameState } from 'senko-types';
import { RoomTestBase } from './utils';

@suite
export class HintMoveTestCases extends RoomTestBase {
  getCanonicalMove(): HintMove {
    return {
      action: 'hint',
      playerId: 0,
      targetPlayerId: 1,

      rank: 2,
      matchingCardIds: [4, 5],
      nonMatchingCardIds: [6, 7],
      stateAfter: {
        ...this.state(),
        clockCount: this.state().clockCount - 1,
      },
    };
  }

  async addMove(move: HintMove): Promise<void> {
    const moveId = 1;
    const moveRef = this.room.collection('moves').doc(moveId.toString());
    return moveRef.set(move);
  }

  @test
  async 'should allow giving a valid rank hint to another player'() {
    const move = this.getCanonicalMove();
    await firebase.assertSucceeds(this.addMove(move));
  }

  @test
  async 'should allow giving a suit hint to another player'() {
    const move: HintMove = {
      action: 'hint',
      playerId: 0,
      targetPlayerId: 1,

      suit: 2,
      matchingCardIds: [4, 6],
      nonMatchingCardIds: [5, 7],
      stateAfter: this.getCanonicalMove().stateAfter,
    };
    await firebase.assertSucceeds(this.addMove(move));
  }

  @test
  async 'should deny giving hint to self'() {
    const move: HintMove = {
      action: 'hint',
      playerId: 0,
      targetPlayerId: 0, // To self.

      rank: 0,
      matchingCardIds: [0, 1],
      nonMatchingCardIds: [2, 3],
      stateAfter: this.state(),
    };
    await firebase.assertFails(this.addMove(move));
  }

  @test
  async 'should deny if clockCount == 0'() {
    await this.adminRoom
      .collection('moves')
      .doc('0')
      .update({
        'stateAfter.clockCount': 0,
      });
    const canonicalMove = this.getCanonicalMove();
    // No matter what the new clockCount is, this should not succeed.
    for (const clockCount of [-1, 0, 1]) {
      const move: HintMove = {
        ...canonicalMove,
        stateAfter: {
          ...canonicalMove.stateAfter,
          clockCount,
        },
      };
      await firebase.assertFails(this.addMove(move));
    }
  }

  @test
  async 'should deny if clockCount not decremented by exactly one'() {
    const canonicalMove = this.getCanonicalMove();
    for (const wrongClockCount of [
      this.state().clockCount - 2,
      this.state().clockCount,
    ]) {
      const move: HintMove = {
        ...canonicalMove,
        stateAfter: {
          ...canonicalMove.stateAfter,
          clockCount: wrongClockCount,
        },
      };
      await firebase.assertFails(this.addMove(move));
    }
  }

  @test
  async 'should deny touching unrelated game state'() {
    const move = this.getCanonicalMove();
    const wrongStates: GameState[] = [
      { ...move.stateAfter, fuseCount: 1 },
      { ...move.stateAfter, deckTopCardId: 9 },
      { ...move.stateAfter, highestRanks: [0, 0, 1, 0, 0] },
      {
        ...move.stateAfter,
        players: [{ hand: [0, 1, 2, 999] }, { hand: [4, 5, 6, 7] }],
      },
    ];
    for (const state of wrongStates) {
      await firebase.assertFails(
        this.addMove({
          ...move,
          stateAfter: state,
        }),
      );
    }
  }

  @test
  async 'should deny hinting BOTH suit and rank'() {
    const move: any = {
      ...this.getCanonicalMove(),

      rank: 2,
      suit: 2,
      matchingCardIds: [4],
      nonMatchingCardIds: [5, 6, 7],
    };
    await firebase.assertFails(this.addMove(move));
  }

  @test
  async 'should deny giving a hint with no matching card'() {
    const move: HintMove = {
      ...this.getCanonicalMove(),

      rank: 0,
      matchingCardIds: [], // No matching card in hand.
      nonMatchingCardIds: [4, 5, 6, 7],
    };
    await firebase.assertFails(this.addMove(move));
  }

  @test
  async 'should deny hint regarding matching cards not in hand'() {
    const move: HintMove = {
      ...this.getCanonicalMove(),

      rank: 0,
      matchingCardIds: [0, 1], // NOT in bob's hand.
      nonMatchingCardIds: [4, 5, 6, 7],
    };
    await firebase.assertFails(this.addMove(move));
  }

  @test
  async 'should deny hint regarding nonmatching cards not in hand'() {
    const move: HintMove = {
      ...this.getCanonicalMove(),

      rank: 2,
      matchingCardIds: [4, 5],
      nonMatchingCardIds: [0, 1], // NOT in bob's hand.
    };
    await firebase.assertFails(this.addMove(move));
  }

  @test
  async 'should deny hint if matchingCards are only partial'() {
    const move: HintMove = {
      ...this.getCanonicalMove(),

      rank: 2,
      matchingCardIds: [4], // Error: 5 should be included here.
      nonMatchingCardIds: [6, 7],
    };
    await firebase.assertFails(this.addMove(move));
  }

  @test
  async 'should deny hint if matchingCards has duplicates'() {
    const move: HintMove = {
      ...this.getCanonicalMove(),

      rank: 2,
      matchingCardIds: [4, 4], // Error: 5 should be included here.
      nonMatchingCardIds: [6, 7],
    };
    await firebase.assertFails(this.addMove(move));
  }

  @test
  async 'should deny hint if matching + nonMatching is not full hand'() {
    const move: HintMove = {
      ...this.getCanonicalMove(),

      rank: 2,
      matchingCardIds: [4, 5],
      nonMatchingCardIds: [6], // Error: 7 should be included here.
    };
    await firebase.assertFails(this.addMove(move));
  }

  @test
  async 'should deny hint if matching card is not actually matching'() {
    const move: HintMove = {
      ...this.getCanonicalMove(),

      rank: 2,
      matchingCardIds: [4, 5, 7], // Error: 7 should be non-matching.
      nonMatchingCardIds: [6],
    };
    await firebase.assertFails(this.addMove(move));
  }

  @test
  async 'should deny hint if non-matching card is actually matching'() {
    const move: HintMove = {
      ...this.getCanonicalMove(),

      rank: 2,
      matchingCardIds: [4],
      nonMatchingCardIds: [5, 6, 7], // Error: 5 should be matching.
    };
    await firebase.assertFails(this.addMove(move));
  }

  @test
  async 'should deny if extra fields are added to move or stateAfter'() {
    const move: any = {
      ...this.getCanonicalMove(),
      foo: 'bar',
    };
    await firebase.assertFails(this.addMove(move));

    const move2: any = {
      ...this.getCanonicalMove(),
      stateAfter: {
        ...this.getCanonicalMove().stateAfter,
        bar: 'baz',
      },
    };
    await firebase.assertFails(this.addMove(move2));
  }

  @test
  async 'should deny moves once game is ended'() {
    await this.adminRoom
      .collection('moves')
      .doc('0')
      .update({
        'stateAfter.fuseCount': 0,
      });
    const move: HintMove = {
      ...this.getCanonicalMove(),
      stateAfter: {
        ...this.getCanonicalMove().stateAfter,
        fuseCount: 0,
      },
    };
    await firebase.assertFails(this.addMove(move));
  }
}
