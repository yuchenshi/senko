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
import { RoomTestBase } from './utils';
import * as assert from 'assert';

@suite
export class CardsTestCases extends RoomTestBase {
  @test
  async 'should deny query to all cards without filtering'() {
    await firebase.assertFails(this.room.collection('cards').get());
  }

  @test
  async 'should allow query to all cards visible to self'() {
    const cards = await this.room
      .collection('cards')
      .where('shownToUids', 'array-contains', 'alice')
      .get();
    const cardIds = new Set(cards.docs.map(doc => parseInt(doc.id, 10)));
    assert.deepStrictEqual(cardIds, new Set([4, 5, 6, 7]));
  }

  @test
  async 'should deny query to all cards visible to other player'() {
    await firebase.assertFails(
      this.room
        .collection('cards')
        .where('shownToUids', 'array-contains', 'bob')
        .get(),
    );
  }

  @test
  async 'should deny spectator to query by uid'() {
    const db = this.authedDb({ uid: 'eve' }); // NOT in game.
    const room = db.collection('rooms').doc(this.room.id);

    await firebase.assertFails(this.room.collection('cards').get());
    await firebase.assertFails(
      room
        .collection('cards')
        .where('shownToUids', 'array-contains', 'alice')
        .get(),
    );
    await firebase.assertFails(
      room
        .collection('cards')
        .where('shownToUids', 'array-contains', 'bob')
        .get(),
    );
  }

  @test
  async 'should allow spectator to query revealed cards'() {
    const db = this.authedDb({ uid: 'eve' }); // NOT in game.
    const room = db.collection('rooms').doc(this.room.id);

    const cards = await room
      .collection('cards')
      .where('revealedByMoveId', '>=', 0)
      .get();
    const cardIds = new Set(cards.docs.map(doc => parseInt(doc.id, 10)));
    assert.deepStrictEqual(cardIds, new Set([]));
  }
  @test
  async 'should deny updates without drawnByMoveId or revealedByMoveId'() {
    const wrongUpdates = [
      { rank: 4 },
      { suite: 4 },
      { foo: 5 },
      { shownToUids: ['alice', 'bob'] },
    ];
    for (const update of wrongUpdates) {
      await firebase.assertFails(
        this.room
          .collection('cards')
          .doc('0')
          .update(update),
      );
    }
  }

  @test
  async 'should deny revealing card if already revealed'() {
    // As part of the commit, the card will be revealed.
    const moveRef = await this.play(0)
      .draw()
      .commit();

    const update = {
      shownToUids: ['alice', 'bob'],
      revealedByMoveId: parseInt(moveRef.id, 10),
    };
    const cardRef = this.room.collection('cards').doc('1');
    await firebase.assertFails(cardRef.update(update));
  }

  @test
  async 'should deny revealing a different card than played'() {
    const cardId = 0;
    const helper = await this.play(cardId).draw();
    const update = helper.cardUpdates.get(cardId)!;
    helper.cardUpdates.set(cardId + 1, update);
    await firebase.assertFails(helper.commit());

    helper.cardUpdates.delete(cardId);
    await firebase.assertFails(helper.commit());
  }

  @test
  async 'should deny wrong updates to shownToUids on reveal'() {
    const cardId = 0;
    const helper = await this.play(cardId).draw();
    const update = helper.cardUpdates.get(cardId)!;

    const wrongShownToUids = [
      [],
      ['alice'],
      ['bob'],
      ['alice', 'alice'],
      ['alice', 'alice', 'bob'],
      ['alice', 'bob', 'eve'],
      ['eve'],
      ['eve', 'mike'],
    ];

    for (const uids of wrongShownToUids) {
      update.shownToUids = uids;
      await firebase.assertFails(helper.commit());
    }
  }

  @test
  async 'should deny updating BOTH drawnByMoveId and revealedByMoveId'() {
    const cardId = 0;
    const helper = await this.play(cardId).draw();
    const update = helper.cardUpdates.get(cardId)!;
    update.drawnByMoveId = update.revealedByMoveId;
    await firebase.assertFails(helper.commit());
  }

  @test
  async 'should deny touching unrelated fields when updating'() {
    const cardId = 0;
    const helper = await this.play(cardId).draw();
    const update = helper.cardUpdates.get(cardId)!;

    const wrongUpdates = [{ rank: 4 }, { suite: 4 }, { foo: 5 }];
    for (const wrongUpdate of wrongUpdates) {
      helper.cardUpdates.set(cardId, { ...update, ...wrongUpdate });
      await firebase.assertFails(helper.commit());
    }
  }

  @test
  async 'should deny updating shownToUids when drawing if already updated'() {
    const cardToDraw = this.state().deckTopCardId;

    // As part of the commit, the drawn card will be shown to everyone else.
    const moveRef = await this.play(0)
      .draw(cardToDraw)
      .commit();

    const update = {
      shownToUids: ['bob'],
      drawnByMoveId: parseInt(moveRef.id, 10),
    };
    const cardRef = this.room.collection('cards').doc(cardToDraw.toString());
    await firebase.assertFails(cardRef.update(update));
  }

  @test
  async 'should deny updating a different card than drawn'() {
    const cardToDraw = this.state().deckTopCardId;
    const helper = this.play(0).draw(cardToDraw);
    const update = helper.cardUpdates.get(cardToDraw)!;
    helper.cardUpdates.set(cardToDraw + 1, update);
    await firebase.assertFails(helper.commit());

    helper.cardUpdates.delete(cardToDraw);
    await firebase.assertFails(helper.commit());
  }

  @test
  async 'should deny wrong shownToUids when drawing a card'() {
    const cardToDraw = this.state().deckTopCardId;
    const helper = this.play(0).draw(cardToDraw);
    const update = helper.cardUpdates.get(cardToDraw)!;

    const wrongShownToUids = [
      [],
      ['alice'],
      ['alice', 'alice'],
      ['alice', 'bob'],
      ['alice', 'bob', 'bob'],
      ['alice', 'bob', 'eve'],
      ['eve'],
      ['eve', 'mike'],
    ];

    for (const uids of wrongShownToUids) {
      update.shownToUids = uids;
      await firebase.assertFails(helper.commit());
    }
  }
}
