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
import { GameState } from 'senko-types';
import { RoomTestBase } from './utils';

@suite
export class ReactionTestCases extends RoomTestBase {
  state(): GameState {
    return {
      ...super.state(),
      highestRanks: [-1, 0, 1, 2, 3],
    };
  }

  @test
  async 'should allow valid success reaction'() {
    const moveRef = await this.play(0)
      .draw()
      .commit();
    await firebase.assertSucceeds(
      moveRef.update({
        result: 'success',
        'stateAfter.highestRanks': [0, 0, 1, 2, 3],
      }),
    );
  }

  @test
  async 'should deny reaction to a move already with result'() {
    const moveRef = await this.play(0)
      .draw()
      .commit();
    await moveRef.update({
      result: 'success',
      'stateAfter.highestRanks': [0, 0, 1, 2, 3],
    });

    await firebase.assertFails(
      moveRef.update({
        result: 'success',
        'stateAfter.highestRanks': [0, 0, 1, 2, 3],
      }),
    );
  }

  @test
  async 'should deny failure reaction if the played card is valid'() {
    const moveRef = await this.play(0)
      .draw()
      .commit();
    await firebase.assertFails(
      moveRef.update({
        result: 'failure',
        'stateAfter.fuseCount': this.state().fuseCount - 1,
      }),
    );
  }

  @test
  async 'should allow deny incrementing clockCount when not playing max rank'() {
    const moveRef = await this.play(0)
      .draw()
      .commit();
    await firebase.assertFails(
      moveRef.update({
        result: 'success',
        'stateAfter.highestRanks': [0, 0, 1, 2, 3],
        'stateAfter.clockCount': this.state().clockCount + 1,
      }),
    );
  }

  @test
  async 'should allow valid failure reaction'() {
    const moveRef = await this.play(1)
      .draw()
      .commit();
    await firebase.assertSucceeds(
      moveRef.update({
        result: 'failure',
        'stateAfter.fuseCount': this.state().fuseCount - 1,
      }),
    );
  }

  @test
  async 'should deny success reaction if the played card is invalid'() {
    const moveRef = await this.play(1)
      .draw()
      .commit();
    await firebase.assertFails(
      moveRef.update({
        result: 'success',
        'stateAfter.highestRanks': [-1, 0, 1, 2, 3],
      }),
    );
  }

  @test
  async 'should allow incrementing clockCount for playing max rank'() {
    const moveRef = await this.play(3)
      .draw()
      .commit();
    await firebase.assertSucceeds(
      moveRef.update({
        result: 'success',
        'stateAfter.highestRanks': [-1, 0, 1, 2, 4],
        'stateAfter.clockCount': this.state().clockCount + 1,
      }),
    );
  }

  @test
  async 'should deny if clockCount not incremented for playing max rank'() {
    const moveRef = await this.play(3)
      .draw()
      .commit();
    await firebase.assertFails(
      moveRef.update({
        result: 'success',
        'stateAfter.highestRanks': [-1, 0, 1, 2, 4],
      }),
    );
  }

  @test
  async 'should cap updated clockCount at maxClockCount'() {
    const maxClockCount = this.state().clockCount;
    await this.adminRoom.update({
      'rules.maxClockCount': maxClockCount,
    });
    const moveRef = await this.play(3)
      .draw()
      .commit();

    await firebase.assertFails(
      moveRef.update({
        result: 'success',
        'stateAfter.highestRanks': [-1, 0, 1, 2, 4],
        // Nope: This will go over maxClockCount.
        'stateAfter.clockCount': this.state().clockCount + 1,
      }),
    );

    await firebase.assertSucceeds(
      moveRef.update({
        result: 'success',
        'stateAfter.highestRanks': [-1, 0, 1, 2, 4],
        // Success: maxClockCount unchanged because it is already at max.
      }),
    );
  }

  @test
  async 'should deny touching unrelated fields on success reaction'() {
    const moveRef = await this.play(0)
      .draw()
      .commit();
    const wrongFields = [
      { action: 'discard' },
      { playerId: 1 },
      { cardId: 2 },
      { foo: 1 },
      { stateAfter: 'foo' },
      { 'stateAfter.fuseCount': 2 },
      { 'stateAfter.deckTopCardId': 10 },
      {
        'stateAfter.players': [{ hand: [1, 2, 3, 4] }, { hand: [5, 6, 7, 8] }],
      },

      // Updating first 2 elements in array instead of one.
      { 'stateAfter.highestRanks': [0, 1, 1, 2, 3] },
    ];
    for (const fields of wrongFields) {
      await firebase.assertFails(
        moveRef.update({
          result: 'success',
          'stateAfter.highestRanks': [0, 0, 1, 2, 3],
          ...fields,
        }),
      );
    }
  }

  @test
  async 'should deny touching unrelated fields on failure reaction'() {
    const moveRef = await this.play(1)
      .draw()
      .commit();
    const wrongFields = [
      { action: 'discard' },
      { playerId: 1 },
      { cardId: 2 },
      { foo: 1 },
      { stateAfter: 'foo' },
      { 'stateAfter.deckTopCardId': 10 },
      { 'stateAfter.clockCount': 1 },
      {
        'stateAfter.players': [{ hand: [1, 2, 3, 4] }, { hand: [5, 6, 7, 8] }],
      },
      { 'stateAfter.highestRanks': [-1, -1, 1, 2, 3] },
    ];
    for (const fields of wrongFields) {
      await firebase.assertFails(
        moveRef.update({
          result: 'failure',
          'stateAfter.fuseCount': this.state().fuseCount - 1,
          ...fields,
        }),
      );
    }
  }
}
