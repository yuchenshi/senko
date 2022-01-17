Senko
=====

Project "Senko" is a web-based implementation of the
[Hanabi board game](https://en.wikipedia.org/wiki/Hanabi_(card_game)).

[**Online Demo**](https://senko-hanabi.web.app)

The front-end uses TypeScript, Stylus, Mithril, Rxjs, and Material Design.

The backend features a serverless design using Firestore as the database, with
game rules validated entirely with Firebase Security Rules.


Features
--------

* Basic gaming with 2-6 players + observers.
* Creating and joining rooms.
* Visual gameplay and layout.
* Extensive in-game hints and "insights", e.g.
    - Possible color / ranks of unknown cards
    - Copies left of a certain card
* Configurable rulesets
    - 5/6 colors
    - Wildcard (rainbow) cards
    - ~Unicorn~ Unique color (which has only one copy of each rank)


Wishlist
--------

* Ending the game one round after deck runs out
    - Right now, players can keep playing until they have only one card in hand.
    - Ideally, the end-game condition should be configurable.
    - Perfecting the game and too-many-errors are correctly implemented though.
* Animations
* Alerts / notifications when it is your turn
* AI players (e.g. adapters for existing Hanabi algorithms / models)
* Better mobile support


Development / Contributing
--------------------------

This project is a monorepo managed using [Lerna](https://lerna.js.org).

To start, install Lerna and bootstrap:

```bash
npm i -g lerna
lerna bootstrap
```

### Dev server 

The dev server can be started with `npm run dev` at repo root.

This starts a Webpack server for the web part (`./packages/web`) and also
Firebase emulators for Firestore, Functions, and Auth.

Open http://localhost:8081/ in the browser to access the Webpack dev server.
The port is configurable in `./packages/web/webpack.config.js` under
`devServer.port`. (Should you run into port conflicts for the Firebase
emulators, those can be changed via `./packages/server/firebase.json`.
Just keep in mind to always visit the Webpack server, NOT the Firebase
hosting emulator, in your browser.)

You should now be able to create a new room using the `+` button on the bottom
right corner. To join the room as another player (to play test yourself), you
may want to use use a different browser or an incognito / private window.

All front-end changes (TypeScript, Stylus, etc.) should trigger Webpack
hot-reload. Changes to the Security Rules should be automatically picked up by
the Firestore emulator.


### Testing

`npm test` in `./packages/server` should run the tests. These tests are mostly
for the security rules (see below).


### Security Rules

One unconventional design choice of this project is to implement the full game
rules with Firebase Security Rules. Rules enforces that one cannot see their
own cards and all moves (hints, plays, and discards) must be valid.

A Cloud Function is still needed for the initial random shuffling of the deck
to ensure no player (read: client code) can see the full arrangement of cards.
It also handles creation of the initial game state for convenience of
implementation. After that, the entire Hanabi game is deterministic and can be
expressed in terms of Rules conditions and document lookups.

With that being said, since Rules do not support loops or queries, one need to
get creative on expressing the in-game invariants. The Firestore data schema
is designed with these constraints in mind and features quirks and
de-normalizations as a result.

* `/waitingAreas/{roomId}`: pre-game player recruiting and game settings.
* `/rooms/{roomId}`: public metadata and rules about each game.
    - Room schema: `interface Room` in `./packages/types/index.d.ts`.
    - `/cards/{cardId}`: cards in the game with suit/rank and who can see them.
        + The IDs are indexes assigned based on their order in the deck.
        + Moves only references `cardId`s, ensuring the suit/rank of the
          cards is kept secret. This enables playing a card without seeing it.
        + `shownToUids` tracks which users can read the card.
        + Full schema: `interface Card` in `./packages/types/index.d.ts`.
    - `/moves/{moveId}`: actions taken by players (publicly visible).
        + Immutable once created. IDs are indexes acsending from 0 (init).
        + Contains the type of the action and payload (e.g. `play`, `cardId: 1`)
        + Contains `stateAfter`, a snapshot of the board state after the move.
        + Both the action and `stateAfter` are validated by extensive rules.
        + Full schema: `type Move` in `./packages/types/index.d.ts`.

The full Rules can be found at `./packages/server/firestore.rules`.

When making a move, the client code must create `/moves/{moveId}` AND update
visibility of any `/cards/{cardId}` (if changed) at the same time using a
Firestore batch write. For example, when playing / discarding a card, the
`revealedByMoveId` must be set to the proposed `moveId` and the `shownToUids`
list must be set to all players. Also, a new card (if available) is drawn for
replacement, which must be shown to all players EXCEPT the turn player.

A move must also calculate the `stateAfter` by delicately making an updated
copy of the previous move's `stateAfter` with changes according to game rules.
Hint moves must also indicate which cards match the hint. Since this quickly
become complicated, helper functions are created for all types of moves, see
`./packages/client/src/actions.ts`.

The reading paths are comparably easier, but one must keep in mind that Rules
are NOT filters. In other words, the client of a player must read / listen on
queries that only returns cards visible to that player instead of the full
cards collection. Since information is scattered across multiple collections,
a client may see them temporarily out of sync due to timing of listener pushes.
In other words, the client need to solve a stream-to-stream JOIN problem.
`./packages/client/view.ts` handles that gracefully and produces Rxjs
`Observable`s with the most up-to-date information.


Licensing
---------

[Apache License 2.0](./LICENSE).

This project does not contain any material (e.g. graphics or rules text) from
the physical version of the Hanabi board game. The project contributors are not
in any way affiliated with the artists, designers, or publishers of that game.

This is a personal project maintained using my own spare time and own resources.
It is not an officially supported Google product.
