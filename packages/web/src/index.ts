import './styl/index.styl'; // Load all styles.

import m from 'mithril';

import gameComponent from './game';
import { viewWaitingAreaList, waitingAreaComponent } from './room';
import { Subject } from 'rxjs';
import {
  RoomView,
  Action,
  subscribeAndAct,
  subscribeAndReact,
  WaitingArea,
} from 'senko';
import { getServices } from './firebase';

const uidReady = getServices().then(({ auth }) => {
  return new Promise<string>(resolve => {
    auth.onAuthStateChanged(event => {
      if (event && event.uid) {
        resolve(event.uid);
      }
    });
    auth.signInAnonymously();
  });
});

if (location.pathname === '/') {
  getServices().then(({ firestore }) => {
    viewWaitingAreaList(firestore, uidReady);
  });
} else {
  const segments = location.pathname.split('/');
  if (segments.length === 3 && segments[1] === 'rooms') {
    const roomId = decodeURIComponent(segments[2]);
    handleRoom(roomId);
  } else {
    location.href = '/';
  }
}

function handleRoom(roomId: string) {
  getServices().then(({ firestore, functions }) => {
    const room = firestore.collection('rooms').doc(roomId);

    let createRoom: any = null;
    const roomExists = new Promise<boolean>(resolve => {
      const unsubs = room.onSnapshot(roomDoc => {
        if (roomDoc.exists) {
          unsubs();
          resolve(true);
        } else if (!createRoom) {
          createRoom = uidReady.then(uid => {
            const mountPoint = document.querySelector('.sk-main')!;
            const loading = document.querySelector<HTMLDivElement>(
              '.sk-loading',
            )!;
            loading.style.display = 'none';
            const waitingAreaRef = firestore
              .collection('waitingAreas')
              .doc(roomId);
            function startGame() {
              functions.httpsCallable('startGame')({
                roomId: waitingAreaRef.id,
              });
              loading.style.display = 'block';
              m.mount(mountPoint, null);
            }
            m.mount(
              mountPoint,
              waitingAreaComponent(
                WaitingArea.create(waitingAreaRef),
                uid,
                startGame,
              ),
            );
          });
        }
      });
    });
    Promise.all([uidReady, roomExists]).then(([uid]) => {
      const roomView = RoomView.create(room, uid);
      subscribeAndReact(roomView, room);
      const actionsSubj = new Subject<Action>();
      actionsSubj.subscribe(action => console.log(action));
      subscribeAndAct(roomView, room, uid, actionsSubj);
      m.mount(document.body, gameComponent(roomView, uid, actionsSubj));
    });
  });
}
