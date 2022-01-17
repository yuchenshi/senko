import m from 'mithril';
import classNames from 'classnames';
import { Subject, BehaviorSubject, combineLatest } from 'rxjs';
import { RoomView, Action } from 'senko';
import { PlayerId, SuitId, RankId, CardId } from 'senko-types';
import { rxm } from './util';

const SUITS = 'RGBYWP';
const RANKS = '12345';
const suitDesc = ['Red', 'Green', 'Blue', 'Yellow', 'White', 'Purple'];
const rankDesc = ['1', '2', '3', '4', '5'];
const wildDesc = 'Wild';

interface CardDispAttrs {
  card:
    | undefined
    | {
        suit: SuitId | undefined;
        rank: RankId | undefined;
        suitWildForHints?: boolean;
      };
  onclick?: (e: Event) => void;
  label?: string;
  isSuitEliminated?: boolean[];
  isRankEliminated?: boolean[];
  [otherAttr: string]: any;
}

const CardDisp: m.Component<CardDispAttrs> = {
  view({
    attrs: {
      card,
      onclick,
      label,
      isSuitEliminated,
      isRankEliminated,
      ...attrs
    },
  }) {
    let s = card && card.suit !== undefined ? SUITS[card.suit] : 'U';
    if (card?.suitWildForHints) {
      s = '_';
    }
    const r = card && card.rank !== undefined ? RANKS[card.rank] : 'U';
    const alt = describeCard(card, isSuitEliminated, isRankEliminated);
    return m('.card-sized', { onclick, ...attrs }, [
      m('img', {
        src: `/imgs/cards/${s}${r}.svg`,
        alt,
        title: label ?? alt,
        'aria-label': label || alt,
      }),
    ]);
  },
};

interface PlayerHandAttrs {
  roomView: RoomView;
  pid: PlayerId;
  playerName: string;
  actionsSubj: Subject<Action>;
  selectedCardIdSubj: BehaviorSubject<CardId | undefined>;
  isSelf: boolean;
}

interface FilterCondition {
  suit?: SuitId;
  rank?: RankId;
}

interface PlayerHandState {
  filter?: FilterCondition;
}

const PlayerHand: m.Component<PlayerHandAttrs, PlayerHandState> = {
  view({
    state,
    attrs: {
      roomView,
      pid,
      playerName,
      actionsSubj,
      selectedCardIdSubj,
      isSelf,
    },
  }) {
    return rxm(
      combineLatest([
        roomView.handsWithInsights(),
        roomView.currentState(),
        roomView.rules(),
      ]),
      ([hands, { clockCount }, { rankCount, suitCount }]) =>
        hands[pid].map(
          (
            {
              cardId,
              hintedSuit,
              hintedRank,
              isSuitEliminated,
              isRankEliminated,
              suit,
              suitWildForHints,
              rank,
              remainingCopies,
              isExtraneous,
            },
            i,
          ) => {
            const orderText =
              i === 0 ? 'oldest' : i === hands[pid].length - 1 ? 'latest' : '';
            const onHintAction = (hint: {
              field: 'suit' | 'rank';
              expected: SuitId | RankId;
            }) => {
              if (clockCount === 0) {
                alert('No hints left!');
                return;
              }
              actionsSubj.next({
                action: 'hint',
                targetPlayerId: pid,
                ...hint,
              });
            };
            const onFilter = (filter: FilterCondition) =>
              (state.filter = { ...state.filter, ...filter });

            const copiesDesc = isExtraneous
              ? '(Card no longer needed)'
              : !remainingCopies
              ? ''
              : remainingCopies === 1
              ? 'LAST COPY (in hands/deck)'
              : `${remainingCopies} copies (in hand/deck)`;

            return rxm(selectedCardIdSubj, selectedCardId =>
              m(
                '.sk-player-hand-card',
                {
                  class: classNames({
                    'sk-card-selected': selectedCardId === cardId,
                    'sk-card-nonmatching':
                      state.filter &&
                      !matchFilter(state.filter, {
                        suit,
                        rank,
                        suitWildForHints,
                      }),
                    'sk-card-extraneous': isExtraneous,
                    'sk-card-last-copy': remainingCopies === 1,
                  }),
                },
                [
                  m('.sk-card-value', [
                    m(HintButton, {
                      field: 'suit',
                      value: suit,
                      wild: suitWildForHints,
                      hintedValue: hintedSuit,
                      isSelf,
                      playerName,
                      isValueEliminated: isSuitEliminated,
                      onHintAction,
                      onFilter,
                    }),
                    m(HintButton, {
                      field: 'rank',
                      value: rank,
                      hintedValue: hintedRank,
                      isSelf,
                      playerName,
                      isValueEliminated: isRankEliminated,
                      onHintAction,
                      onFilter,
                    }),
                  ]),
                  m('.sk-card-wrapper.card-sized', {}, [
                    m(
                      CardDisp,
                      isSelf
                        ? {
                            card: { suit, rank, suitWildForHints },
                            role: 'button',
                            tabindex: '0',
                            label: copiesDesc,
                            isSuitEliminated,
                            isRankEliminated,
                            onclick(e) {
                              (e as any).redraw = false;
                              if (selectedCardIdSubj.getValue() !== cardId) {
                                selectedCardIdSubj.next(cardId);
                              } else {
                                // Clicking the same card unselects it.
                                selectedCardIdSubj.next(undefined);
                              }
                            },
                          }
                        : {
                            card: { suit, rank, suitWildForHints },
                            isSuitEliminated,
                            isRankEliminated,
                            label:
                              describeCard({ suit, rank }) + '\n' + copiesDesc,
                            onclick() {
                              alert(
                                describeCard({ suit, rank }) +
                                  '\n' +
                                  describePossible(SUITS, isSuitEliminated) +
                                  '\n' +
                                  describePossible(RANKS, isRankEliminated) +
                                  '\n' +
                                  copiesDesc,
                              );
                            },
                          },
                    ),
                    m('.sk-inspect-wrapper', {}, [
                      ,
                      m('.sk-inspect', {}, [
                        m('span.material-icons', 'find_in_page'),
                      ]),
                      m('.sk-inspect-insights', {}, [
                        m('div', {}, [
                          ...([].map.call(SUITS, (s, i) => {
                            if (i >= suitCount) return null;
                            const e = isSuitEliminated?.[i];
                            return m(
                              'span.sk-possible-suit',
                              {
                                class: e
                                  ? 'sk-eliminated'
                                  : hintedSuit != null && hintedSuit !== i
                                  ? 'sk-insight-outdated'
                                  : '',
                              },
                              e ? '-' : s,
                            );
                          }) as m.Vnode[]),
                        ]),
                        m('div', {}, [
                          ...([].map.call(RANKS, (r, i) => {
                            if (i >= rankCount) return null;
                            const e = isRankEliminated?.[i];
                            return m(
                              'span.sk-possible-rank',
                              {
                                class: e
                                  ? 'sk-eliminated'
                                  : hintedRank != null && hintedRank !== i
                                  ? 'sk-insight-outdated'
                                  : '',
                              },
                              e ? '-' : r,
                            );
                          }) as m.Vnode[]),
                        ]),
                      ]),
                      m('.sk-inspect-copies', {}, [
                        isExtraneous
                          ? m('span.material-icons', 'signal_cellular_no_sim')
                          : remainingCopies == null
                          ? ''
                          : m(
                              'span.material-icons',
                              'filter_' + remainingCopies,
                            ),
                      ]),
                    ]),
                  ]),
                  m('.sk-card-order', [orderText]),
                ],
              ),
            );
          },
        ),
    );
  },
};

function matchFilter(
  filter: FilterCondition,
  card: {
    suit: SuitId | undefined;
    rank: RankId | undefined;
    suitWildForHints?: boolean;
  },
) {
  if (filter.suit != null) {
    if (card.suitWildForHints) {
      return true;
    }
    if (card.suit !== filter.suit) {
      return false;
    }
  }
  if (filter.rank != null) {
    if (card.rank !== filter.rank) {
      return false;
    }
  }
  return true;
}

interface HintButtonBasicProps<Field extends 'suit' | 'rank'> {
  field: Field;
  isSelf: boolean;
  wild?: boolean;
  value?: Field extends 'suit' ? SuitId : RankId;
  hintedValue?: Field extends 'suit' ? SuitId : RankId;
  onHintAction: (hint: {
    field: 'suit' | 'rank';
    expected: Field extends 'suit' ? SuitId : RankId;
  }) => void;
  onFilter: (condition: FilterCondition) => void;
  playerName: string;
  isValueEliminated?: boolean[];
}

type HintButtonProps =
  | HintButtonBasicProps<'suit'>
  | HintButtonBasicProps<'rank'>;

const HintButton: m.Component<HintButtonProps> = {
  view({
    attrs: { isSelf, field, value, hintedValue, onFilter, wild, ...attrs },
  }) {
    const shortNames = field === 'suit' ? SUITS : RANKS;
    const actionable = !isSelf && hintedValue == null;

    let title = '';
    if (hintedValue != null) {
      if (field === 'suit') {
        title = `This card is ${suitDesc[hintedValue]} according to hints.`;
      } else {
        title = `This card has Rank ${rankDesc[hintedValue]} according to hints.`;
      }
    } else if (isSelf) {
      title = describePossible(shortNames, attrs.isValueEliminated) || '';
    } else if (wild) {
      title = `This is a wild card. Click to select a hint for ${attrs.playerName}.`;
    } else if (value != null) {
      const hint = field == 'suit' ? { suit: value } : { rank: value };
      title = `Tell ${attrs.playerName} about all their ${describeHint(hint)}`;
    }

    return m(
      'button',
      {
        class: classNames(`sk-card-value-${field}`, {
          'sk-card-value-hinted': hintedValue != null,
        }),
        title,
        'aria-label': title,
        'aria-hidden': actionable ? 'undefined' : 'true',
        tabindex: actionable ? undefined : '-1',
        onclick() {
          if (isSelf) {
            alert(title);
          } else if (value != null) {
            let expected: number;
            if (wild) {
              const result = prompt(
                `Which hint would you like to give? (${SUITS.substr(
                  0,
                  value,
                )})`,
                '',
              );
              if (!result) {
                return;
              }
              expected = SUITS.indexOf(result);
              if (expected < 0 || expected >= value) {
                alert('Invalid choice!');
                return;
              }
            } else {
              expected = value;
            }
            attrs.onHintAction({ field, expected: value });
          }
        },
        onmouseenter: isSelf
          ? undefined
          : () => {
              if (value != null) {
                onFilter({ [field]: value });
              }
            },
        onmouseleave: isSelf
          ? undefined
          : () => onFilter({ [field]: undefined }),
      },
      wild ? '*' : value != null ? shortNames[value] : '?',
    );
  },
};

export default function gameComponent(
  roomView: RoomView,
  myUid: string,
  actionsSubj: Subject<Action>,
): m.Component<{}, { selectedPlayerId?: number }> {
  const selectedCardIdSubj = new BehaviorSubject<CardId | undefined>(undefined);
  return {
    view({ state }) {
      return m('.sk-game-wrapper', [
        m('.sk-game', [
          m('.sk-back'),
          m(Table, { roomView, selectedCardIdSubj, actionsSubj }),
          rxm(roomView.players(), players => {
            const myPid = players.map(p => p.uid).indexOf(myUid);
            const pCount = players.length;
            return m(
              '.sk-hands',
              { class: `sk-hands-${pCount}players` },
              players.map(player => {
                // Always render one's own hand at a certain location.
                // And determine the position of other players by their
                // turn order (e.g. the 3rd player after self).
                const turnsAfterSelf = (player.id + pCount - myPid) % pCount;
                const isSelf = player.id == myPid;
                return m(
                  '.sk-player-hand',
                  {
                    class:
                      `sk-player-hand-n${turnsAfterSelf}` +
                      (state.selectedPlayerId === player.id
                        ? ' sk-player-hand-selected'
                        : ''),
                    // Helper to "select" a player's hand to show them (touchscreen alternative for :hover styling).
                    onclick() {
                      console.log('click', player.id);
                      state.selectedPlayerId = player.id;
                    },
                  },
                  [
                    rxm(roomView.currentPlayerId(), currentPlayerId =>
                      m(
                        '.sk-player-name',
                        {
                          class:
                            currentPlayerId === player.id
                              ? 'sk-player-name-active'
                              : '',
                        },
                        [
                          m(
                            'span.material-icons',
                            currentPlayerId === player.id
                              ? 'person_pin'
                              : 'person',
                          ),
                          `${player.name}`,
                          currentPlayerId === player.id ? ' (current)' : '',
                        ],
                      ),
                    ),
                    m(PlayerHand, {
                      roomView,
                      pid: player.id,
                      playerName: player.name,
                      actionsSubj,
                      selectedCardIdSubj,
                      isSelf,
                    }),
                  ],
                );
              }),
            );
          }),
        ]),
      ]);
    },
  };
}

interface TableAttrs {
  roomView: RoomView;
  selectedCardIdSubj: BehaviorSubject<CardId | undefined>;
  actionsSubj: Subject<Action>;
}

const Table: m.Component<TableAttrs> = {
  view({ attrs: { roomView, selectedCardIdSubj, actionsSubj } }) {
    return m('.sk-table', [
      rxm(
        combineLatest([
          roomView.currentState(),
          selectedCardIdSubj,
          roomView.rules(),
          roomView.cardCopiesBySuitAndRank(),
        ]),
        ([
          { highestRanks },
          selectedCardId,
          { rankCount, suits },
          cardCopies,
        ]) =>
          m(
            '.sk-score-pile',
            {
              class: selectedCardId !== undefined ? 'sk-action-target' : '',
              onclick(e: any) {
                e.redraw = false;
                if (selectedCardId !== undefined) {
                  actionsSubj.next({ action: 'play', cardId: selectedCardId });
                  selectedCardIdSubj.next(undefined);
                }
              },
            },
            [
              highestRanks.map((rank, suit) => {
                const wild = suits[suit].wildForHints;
                let desc =
                  rank === -1
                    ? `No ${
                        wild ? wildDesc : suitDesc[suit]
                      } card have been played.`
                    : rank === 0
                    ? `${describeCard({
                        suit,
                        rank,
                      })} has been successfully played.`
                    : `${describeCard({
                        suit,
                        rank: 0,
                      })} through ${describeCard({
                        suit,
                        rank,
                      })} have been successfully played.`;
                if (rank === rankCount - 1) {
                  desc += '\n(COMPLETE)';
                } else {
                  const nextRank = rank + 1;
                  const copies = cardCopies[suit][nextRank];
                  desc += `\nNext needed: ${describeCard({
                    suit,
                    rank: nextRank,
                  })} (${copies.remaining} remaining)`;
                }
                const s = wild ? '_' : SUITS[suit];
                return m('.sk-score-cards', [
                  m('img', {
                    src: `/imgs/piles/${s}${rank + 1}.svg`,
                    alt: desc,
                    title: desc,
                  }),
                ]);
              }),
            ],
          ),
      ),
      m('.sk-table-status', [
        m('.sk-table-status-basics', [
          m('.sk-table-status-hints', [
            'Hints: ',
            rxm(roomView.currentState(), ({ clockCount }) => clockCount),
            '/',
            rxm(roomView.rules(), ({ maxClockCount }) => maxClockCount),
          ]),
          rxm(
            combineLatest([roomView.currentState(), roomView.rules()]),
            ([state, rules]) =>
              m(
                '.sk-table-status-errors',
                {
                  className:
                    state.fuseCount === 0 ? 'sk-table-status-errors-full' : '',
                },
                [
                  `Errors: ${rules.initFuseCount - state.fuseCount}/${
                    rules.initFuseCount
                  }`,
                ],
              ),
          ),
        ]),
        rxm(
          combineLatest([roomView.currentState(), roomView.rules()]),
          ([state, rules]) => {
            const cardsLeft = rules.totalCardCount - state.deckTopCardId;
            return m('.sk-table-deck.card-sized', [
              m('img', {
                src: '/imgs/card_back.svg',
                alt: `Deck has ${cardsLeft} cards left.`,
              }),
              m('.sk-table-deck-count', { 'aria-hidden': 'true' }, [
                `${cardsLeft}`,
              ]),
            ]);
          },
        ),
        m(LogViewer, { roomView }),
      ]),
      rxm(
        combineLatest([
          roomView.discardedCardIds(),
          roomView.visibleCards(),
          selectedCardIdSubj,
          roomView.currentState(),
          roomView.rules(),
        ]),
        ([cardIds, cards, selectedCardId, state, rules]) =>
          m(
            '.sk-discard-pile',
            {
              class: selectedCardId !== undefined ? 'sk-action-target' : '',
              onclick(e: any) {
                e.redraw = false;
                if (selectedCardId !== undefined) {
                  if (state.clockCount === rules.maxClockCount) {
                    alert('You may not discard because hints are at max.');
                    return;
                  }
                  actionsSubj.next({
                    action: 'discard',
                    cardId: selectedCardId,
                  });
                  selectedCardIdSubj.next(undefined);
                }
              },
            },
            [
              cardIds.map(cardId =>
                m('.sk-discard-pile-card', [
                  m(CardDisp, { card: cards.get(cardId) }),
                ]),
              ),
            ],
          ),
      ),
    ]);
  },
};

function describeCard(
  card: { suit: SuitId | undefined; rank: RankId | undefined } | undefined,
  isSuitEliminated?: boolean[],
  isRankEliminated?: boolean[],
): string {
  if (!card || (card.suit === undefined && card.rank === undefined)) {
    return 'a card';
  }
  if (card.suit === undefined) {
    const suits = describePossible(SUITS, isSuitEliminated);
    const suitDesc = suits ? `Color ${suits}` : 'unknown color';
    return `a Rank-${rankDesc[card.rank!]} card with ${suitDesc}`;
  }
  if (card.rank === undefined) {
    const ranks = describePossible(RANKS, isRankEliminated);
    const rankDesc = ranks ? `Rank ${ranks}` : 'unknown rank';
    return `a ${suitDesc[card.suit]} card with ${rankDesc}`;
  }
  return `[${suitDesc[card.suit]} ${rankDesc[card.rank]}]`;
}

function describePossible(
  shortNames: { [v: number]: string },
  isValueEliminated?: boolean[],
): string | undefined {
  if (!isValueEliminated) {
    return undefined;
  }

  let result = '';
  for (let i = 0; i < isValueEliminated.length; i++) {
    if (!isValueEliminated[i]) {
      result = result ? `${result}|${shortNames[i]}` : shortNames[i];
    }
  }
  return result;
}

function describeHint(hint: { suit: SuitId } | { rank: RankId }): string {
  if ('suit' in hint) {
    return `${suitDesc[hint.suit]} cards`;
  } else {
    return `cards with Rank ${rankDesc[hint.rank]}`;
  }
}

const LogViewer: m.Component<{ roomView: RoomView }, { expanded?: boolean }> = {
  view({ attrs, state }) {
    return m(
      '.sk-table-status-logs',
      {
        className: state.expanded ? 'sk-table-status-logs-expanded' : '',
        onclick() {
          state.expanded = !state.expanded;
        },
        onupdate(vnode) {
          vnode.dom.scrollTop = vnode.dom.scrollHeight;
        },
      },
      [
        rxm(
          attrs.roomView.eventLog({
            describeCard,
            describeHint,
          }),
          logs =>
            m('div', [
              logs.map((log, i) => i !== logs.length - 1 && m('div', [log])),
              // aria-live only works when content is updated in an existing
              // element, so we need to keep this div separate and always put
              // the latest log entry here for it to be announced.
              m('.sk-table-status-log-latest[aria-live=polite]', [
                logs.length > 0 ? logs[logs.length - 1] : '',
              ]),
            ]),
        ),
      ],
    );
  },
};
