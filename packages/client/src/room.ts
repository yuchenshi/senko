// TODO: Utils for creating waiting area and joining.

import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { collection, doc } from 'rxfire/firestore';
import { DocumentReference } from '@firebase/firestore-types';

export interface WaitingAreaUser {
  name: string;
  role: 'player' | 'spectator';
  uid: string;
}

export interface WaitingAreaData {
  name: string;
  status: string;
  ownerUid: string;
  preset?: string;
}

/**
 * Provides helper functions to observe the state of a waiting area.
 */
export class WaitingArea {
  private constructor(
    public ref: DocumentReference,
    private areaDataObs: Observable<WaitingAreaData>,
    private usersObs: Observable<WaitingAreaUser[]>,
  ) {}

  /**
   * Get a view of a waiting area, by subscribing to snapshots for the
   * waitingArea DocumentReference (and its subcollections).
   */
  public static create(waitingArea: DocumentReference): WaitingArea {
    const roomDataObs = doc(waitingArea).pipe(
      map(snap => snap.data() as WaitingAreaData),
    );
    const usersObs = collection(
      waitingArea.collection('users').orderBy('joinedAt'),
    ).pipe(
      map(snaps => {
        return snaps.map(doc => ({
          ...(doc.data() as { name: string; role: 'player' | 'spectator' }),
          uid: doc.id,
        }));
      }),
    );
    return new WaitingArea(waitingArea, roomDataObs, usersObs);
  }

  roleByUid(uid: string): Observable<'player' | 'spectator' | undefined> {
    return this.usersObs.pipe(
      map(users => users.find(u => u.uid === uid)?.role),
    );
  }

  name(): Observable<string> {
    return this.areaDataObs.pipe(map(({ name }) => name));
  }

  users(): Observable<WaitingAreaUser[]> {
    return this.usersObs;
  }

  canStartGame(): Observable<boolean> {
    return this.usersObs.pipe(
      map(users => {
        let playerCount = 0;
        for (const user of users) {
          if (user.role === 'player') {
            playerCount++;
          }
        }
        return playerCount > 2 && playerCount <= 6;
      }),
    );
  }

  canUpdate(myUid: string): Observable<boolean> {
    return this.areaDataObs.pipe(map(({ ownerUid }) => ownerUid === myUid));
  }

  gameOptions(): Observable<Pick<WaitingAreaData, 'preset'>> {
    return this.areaDataObs.pipe(map(({ preset }) => ({ preset })));
  }
}
