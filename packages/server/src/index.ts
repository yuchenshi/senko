import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { Room, PlayerId, CardId, Card, InitMove, Rules } from 'senko-types';
const shuffle = require('lodash.shuffle');

admin.initializeApp();

const MAX_CLOCK_COUNT = 8;
const INIT_FUSE_COUNT = 3;
const RANK_COUNT = 5;
const COPIES_PER_RANK_NORMAL = [3, 2, 2, 2, 1]; /* three 1s, two 2-4s, one 5 */
// One per each card, only used for the "unique" rank, if enabled in game rules.
const COPIES_PER_RANK_REDUCED = [1, 1, 1, 1, 1];

interface GameOptions {
  suitCount: 5 | 6;
}

export const startGame = functions.https.onCall(
  async (data: any, context: any) => {
    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'The function must be called while authenticated.',
      );
    }

    const roomId = data.roomId;
    const waitingAreaRef = admin
      .firestore()
      .collection('waitingAreas')
      .doc(roomId);
    const waitingArea = (await waitingAreaRef.get()).data()!;
    if (waitingArea.ownerUid !== context.auth.uid && false) {
      // TODO
      throw new functions.https.HttpsError(
        'permission-denied',
        'Only the room owner can start a game.',
      );
    }
    if (waitingArea.status !== 'looking') {
      throw new functions.https.HttpsError(
        'permission-denied',
        'The waiting area is not in "looking" status.',
      );
    }
    const users = await waitingAreaRef
      .collection('users')
      .orderBy('joinedAt')
      .get();
    const playerDocs = users.docs
      .filter(doc => doc.data().role === 'player')
      .slice(0, 6); // TODO
    const playerNameById: string[] = [];
    const playerUids: string[] = [];
    playerDocs.forEach(doc => {
      playerUids.push(doc.id);
      playerNameById.push(doc.data().name);
    });

    const playerIdByUid: { [uid: string]: PlayerId } = {};
    playerUids.forEach((p, i) => {
      playerIdByUid[p] = i;
    });

    const options: GameOptions = waitingArea.rules;
    const suits: Rules['suits'] = [];
    for (let suit = 0; suit < 5; suit++) {
      suits.push({
        wildForHints: false,
        copiesPerRank: COPIES_PER_RANK_NORMAL,
      });
    }
    if (waitingArea.preset === 'rainbow') {
      suits.push({
        wildForHints: true,
        copiesPerRank: COPIES_PER_RANK_NORMAL,
      });
    } else if (waitingArea.preset === 'unicorn') {
      suits.push({
        wildForHints: false,
        copiesPerRank: COPIES_PER_RANK_REDUCED,
      });
    } else if (
      (waitingArea.preset === '6colors' || !waitingArea.preset) &&
      options.suitCount !== 5
    ) {
      suits.push({
        wildForHints: false,
        copiesPerRank: COPIES_PER_RANK_NORMAL,
      });
    }
    const cards = generateCards(suits);

    const handSize = playerUids.length > 3 ? 4 : 5;

    const roomData: Room = {
      playerIdByUid,
      uidByPlayerId: playerUids,
      playerNameById,
      rules: {
        suits,
        rankCount: RANK_COUNT,
        suitCount: suits.length,
        totalCardCount: cards.length,
        maxClockCount: MAX_CLOCK_COUNT,
        initFuseCount: INIT_FUSE_COUNT,
        handSize,
      },
    };

    let deckTopCardId = 0;
    const players = roomData.uidByPlayerId.map((uid, _) => {
      const handShownToUids = roomData.uidByPlayerId.filter(u => u !== uid);
      const hand: CardId[] = [];

      for (let i = 0; i < roomData.rules.handSize; i++) {
        hand.push(deckTopCardId);
        cards[deckTopCardId].drawnByMoveId = 0;
        cards[deckTopCardId].shownToUids = handShownToUids;
        deckTopCardId += 1;
      }
      return { hand };
    });

    const initMoveData: InitMove = {
      action: 'init',
      playerId: -1,
      stateAfter: {
        clockCount: roomData.rules.maxClockCount,
        fuseCount: roomData.rules.initFuseCount,
        deckTopCardId,
        players,
        highestRanks: Array(roomData.rules.suitCount).fill(-1),
      },
    };

    const room = admin
      .firestore()
      .collection('rooms')
      .doc(roomId);
    const batch = admin.firestore().batch();
    batch.update(waitingAreaRef, { status: 'ingame' });
    batch.create(room, roomData);
    batch.create(room.collection('moves').doc('0'), initMoveData);
    cards.forEach((card: any, i: number) => {
      batch.create(room.collection('cards').doc(i.toString()), card);
    });
    await batch.commit();

    return {};
  },
);

function generateCards(suits: Rules['suits']): Card[] {
  const cards: Card[] = [];
  for (let suit = 0; suit < suits.length; suit++) {
    const { copiesPerRank, wildForHints } = suits[suit];
    for (let rank = 0; rank < copiesPerRank.length; rank++) {
      for (let i = 0; i < copiesPerRank[rank]; i++) {
        const card: Card = { rank, suit, shownToUids: [] };
        if (wildForHints) {
          card.suitWildForHints = true;
        }
        cards.push(card);
      }
    }
  }
  return shuffle(cards);
}
