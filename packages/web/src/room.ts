import m from 'mithril';
import { Firestore, FieldValue } from './firebase';
import { WaitingArea, WaitingAreaUser } from 'senko';
import { rxm } from './util';
import { combineLatest } from 'rxjs';

const SUIT_COUNT = location.search.indexOf('5color') >= 0 ? 5 : 6;

export function viewWaitingAreaList(
  firestore: Firestore,
  uidReady: Promise<string>,
) {
  const waitingAreas = firestore.collection('waitingAreas');
  waitingAreas.orderBy('createdAt', 'desc').onSnapshot(snap => {
    document.querySelector<HTMLDivElement>('.sk-loading')!.style.display =
      'none';
    m.render(document.querySelector('.sk-room-list')!, [
      m(
        'ul.mdc-list.mdc-list--two-line.mdc-list--avatar-list',
        {
          'aria-orientation': 'vertical',
        },
        snap.docs.map(doc => RoomItem(doc.id, doc.data())),
      ),
      m(
        'button.mdc-fab.sk-create-room',
        {
          'aria-label': 'Create Room',
          title: 'Create Room',
          onclick() {
            const el = document.querySelector('.sk-aside')!;
            m.render(el, []);
            m.mount(
              el,
              CreateRoomDialog(form => {
                (document.querySelector('.sk-loading') as any).style.display =
                  'block';
                uidReady.then(uid => {
                  const batch = firestore.batch();
                  const room = firestore.collection('waitingAreas').doc();
                  batch.set(room, {
                    name: form.roomName,
                    status: 'looking',
                    ownerUid: uid,
                    rules: { suitCount: SUIT_COUNT },
                    createdAt: FieldValue.serverTimestamp(),
                  });
                  batch.set(room.collection('users').doc(uid), {
                    name: form.playerName,
                    role: 'player',
                    joinedAt: FieldValue.serverTimestamp(),
                  });
                  batch.commit().then(() => {
                    location.href = '/rooms/' + encodeURIComponent(room.id);
                  });
                });
              }),
            );
          },
        },
        [m('span.mdc-fab__icon.material-icons', 'add')],
      ),
    ]);
  });
}

const STATUS_TEXT: { [status: string]: string } = {
  looking: 'Looking for players. Click to join.',
  ingame: 'In-game. Click to speculate.',
  postgame: 'Game has finished.',
};

function RoomItem(id: string, room: any) {
  return m('li.sk-room-list-room', { class: 'sk-room-' + room.status }, [
    m(
      'a.sk-room-list-room-link.mdc-list-item',
      {
        href: '/rooms/' + encodeURIComponent(id),
      },
      [
        m('span.mdc-list-item__graphic.material-icons', {
          'aria-hidden': 'true',
        }),
        m('span.mdc-list-item__text', [
          m('span.sk-room-name.mdc-list-item__primary-text', room.name),
          m(
            'span.sk-room-status.mdc-list-item__secondary-text',
            STATUS_TEXT[room.status],
          ),
        ]),
      ],
    ),
  ]);
}

interface DialogAttrs {
  title: string;
  onSubmit: () => void;
  yesLabel: string;
  yesDisabled?: boolean;
}

const Dialog: m.Component<DialogAttrs> = {
  view({ children, attrs }) {
    return m(
      ".mdc-dialog[role='alertdialog'][aria-modal='true'][aria-labelledby='sk-create-room-dialog-title'][aria-describedby='sk-create-room-dialog-content']",
      {
        oncreate(vnode) {
          const MDCDialog = (window as any).mdc.dialog.MDCDialog;
          const dialog = new MDCDialog(vnode.dom);
          dialog.open();
          dialog.listen('MDCDialog:closed', (e: any) => {
            if (e.detail.action === 'yes') {
              attrs.onSubmit();
            }
          });
        },
      },
      [
        m(
          '.mdc-dialog__container',
          m('.mdc-dialog__surface', [
            m('h2.mdc-dialog__title#sk-create-room-dialog-title', attrs.title),
            m('.mdc-dialog__content#sk-create-room-dialog-content', [children]),
            m('footer.mdc-dialog__actions', [
              m(
                "button.mdc-button.mdc-dialog__button[type='button'][data-mdc-dialog-action='no']",
                m('span.mdc-button__label', 'Cancel'),
              ),
              m(
                "button.mdc-button.mdc-dialog__button[type='button'][data-mdc-dialog-action='yes']",
                { disabled: attrs.yesDisabled },
                m('span.mdc-button__label', attrs.yesLabel),
              ),
            ]),
          ]),
        ),
        m('.mdc-dialog__scrim'),
      ],
    );
  },
};

function CreateRoomDialog(
  onSubmit: (form: CreateRoomData) => void,
): m.Component {
  return {
    view() {
      return m(CreateRoomForm, { onSubmit });
    },
  };
}

interface CreateRoomData {
  roomName: string;
  playerName: string;
}

const CreateRoomForm: m.Component<
  { onSubmit: (form: CreateRoomData) => void },
  CreateRoomData
> = {
  view({ attrs, state }) {
    return m(
      Dialog,
      {
        onSubmit: () => attrs.onSubmit(state),
        title: 'Create Room (' + SUIT_COUNT + ' Colors)',
        yesLabel: 'Create',
        yesDisabled: !state.playerName || !state.roomName,
      },
      m('div', [
        m('p', [
          m(TextField, {
            id: 'sk-create-room-player-name',
            label: 'Your Name',
            value: state.playerName,
            onchange(value) {
              const defaultRoomName = state.playerName
                ? `${state.playerName}'s Room`
                : '';
              state.playerName = value;
              if (!state.roomName || state.roomName === defaultRoomName) {
                state.roomName = value ? `${state.playerName}'s Room` : '';
              }
            },
          }),
        ]),
        m('p', [
          m(TextField, {
            id: 'sk-create-room-name',
            label: 'Room Name',
            value: state.roomName,
            onchange(value) {
              state.roomName = value;
            },
          }),
        ]),
      ]),
    );
  },
};

interface TextFieldAttrs {
  id: string;
  label: string;
  value?: string;
  onchange?: (value: string) => void;
}

const TextField: m.Component<TextFieldAttrs, { mdcField?: any }> = {
  oncreate(vnode) {
    const MDCTextField = (window as any).mdc.textField.MDCTextField;
    vnode.state.mdcField = new MDCTextField(vnode.dom);
  },
  onupdate(vnode) {
    if (vnode.attrs.value !== undefined) {
      vnode.state.mdcField && (vnode.state.mdcField.value = vnode.attrs.value);
    }
  },
  view({ attrs }) {
    return m(
      '.mdc-text-field',
      {
        style: { width: '100%' },
      },
      [
        m('input.mdc-text-field__input[type=text][required]', {
          id: attrs.id,
          onchange(e: any) {
            attrs.onchange && attrs.onchange(e.target.value);
          },
          oninput(e: any) {
            attrs.onchange && attrs.onchange(e.target.value);
          },
        }),
        m('label.mdc-floating-label', { for: attrs.id }, attrs.label),
        m('.mdc-line-ripple'),
      ],
    );
  },
};

interface RadioListAttrs {
  name: string;
  options: { label: string; value: string }[];
  value: string;
  onchange?: (value: string) => void;
  disabled?: boolean;
}

const RadioList: m.Component<RadioListAttrs> = {
  oncreate({ dom }) {
    const MDCRadio = (window as any).mdc.radio.MDCRadio;
    const MDCFormField = (window as any).mdc.formField.MDCFormField;
    dom.querySelectorAll('.mdc-radio').forEach(el => {
      const radio = new MDCRadio(el);
      const formField = new MDCFormField(el.parentElement);
      formField.input = radio;
    });
  },
  view({ attrs }) {
    return m('div', [
      attrs.options.map(({ label, value }) =>
        m('div', [
          m('.mdc-form-field', [
            m(
              '.mdc-radio.mdc-radio--touch',
              { class: attrs.disabled ? 'mdc-radio--disabled' : undefined },
              [
                m('input.mdc-radio__native-control', {
                  type: 'radio',
                  name: attrs.name,
                  id: `${attrs.name}-${value}`,
                  checked: value === attrs.value,
                  disabled: attrs.disabled,
                  onchange(e: any) {
                    if (e.target.checked) {
                      attrs.onchange?.(value);
                    }
                  },
                }),
                m('.mdc-radio__background', [
                  m('.mdc-radio__outer-circle'),
                  m('.mdc-radio__inner-circle'),
                ]),
                m('.mdc-radio__ripple'),
              ],
            ),
            m('label', { for: `${attrs.name}-${value}` }, label),
          ]),
        ]),
      ),
    ]);
  },
};

export function waitingAreaComponent(
  waitingAreaView: WaitingArea,
  myUid: string,
  startGame: () => void,
): m.Component<{}> {
  function join(options: { name: string; role: 'player' | 'spectator' }) {
    const roomUser = waitingAreaView.ref.collection('users').doc(myUid);
    roomUser
      .set({
        name: options.name,
        role: options.role,
        joinedAt: FieldValue.serverTimestamp(),
      })
      .then(undefined, err => {
        console.error(err);
        alert(`Error joining room: ${err.message}`);
      });
  }
  return {
    view() {
      return m('div', [
        m('.mdc-layout-grid', [
          m('.mdc-layout-grid__inner', [
            m('.mdc-layout-grid__cell.mdc-layout-grid__cell--span-12', [
              m('h3.mdc-typography--headline5', [
                rxm(waitingAreaView.name(), name => name),
              ]),
            ]),
            m('.mdc-layout-grid__cell.mdc-layout-grid__cell--span-6', [
              rxm(
                combineLatest([
                  waitingAreaView.users(),
                  waitingAreaView.roleByUid(myUid),
                  waitingAreaView.canUpdate(myUid),
                ]),
                ([users, myRole, canUpdate]) =>
                  m(PlayerList, {
                    users,
                    myRole,
                    join,
                    startGame: canUpdate ? startGame : undefined,
                  }),
              ),
            ]),
            m('.mdc-layout-grid__cell.mdc-layout-grid__cell--span-6', [
              m('.mdc-card.sk-room-options', [
                m('h4.mdc-typography--headline6', 'Game mode'),
                rxm(
                  combineLatest([
                    waitingAreaView.gameOptions(),
                    waitingAreaView.canUpdate(myUid),
                  ]),
                  ([{ preset }, canUpdate]) =>
                    m(RadioList, {
                      disabled: !canUpdate,
                      name: 'preset',
                      options: [
                        { value: '5colors', label: '5 Colors' },
                        { value: '6colors', label: '6 Colors' },
                        { value: 'unicorn', label: '5 Colors + Unique' },
                        { value: 'rainbow', label: '5 Colors + Rainbow' },
                      ],
                      value: preset || '5colors',
                      onchange(value) {
                        waitingAreaView.ref.update('preset', value);
                      },
                    }),
                ),
              ]),
            ]),
          ]),
        ]),
      ]);
    },
  };
}

const PlayerList: m.Component<{
  users: WaitingAreaUser[];
  myRole?: WaitingAreaUser['role'];
  join: (options: { name: string; role: 'player' | 'spectator' }) => void;
  startGame?: () => void;
}> = {
  oncreate({ attrs }) {
    if (!attrs.myRole) {
      const name = prompt('To join the room, please input your name.');
      if (!name) {
        location.href = '/';
        return;
      }
      attrs.join({ name, role: 'player' });
    }
  },
  view({ attrs }) {
    return m('.mdc-card', [
      m('h4.mdc-typography--headline6.sk-room-players', 'Players'),
      m(
        'ul.mdc-list.mdc-list--two-line.mdc-list--avatar-list.sk-room-players',
        {
          'aria-orientation': 'vertical',
        },
        attrs.users.map(user => UserItem(user)),
      ),
      m(
        '.mdc-card__actions',
        { style: 'padding: 0 16px; text-align: center' },
        [
          attrs.startGame
            ? m(
                'button.mdc-button.mdc-button--raised.mdc-button--touch.mdc-card__action.mdc-card__action--button',
                {
                  onclick() {
                    if (attrs.users.length > 6) {
                      alert(
                        'Currently, only up to 6 players are supported. \n' +
                          'Extra players will be converted to spectators.',
                      );
                    }
                    attrs.startGame?.();
                  },
                },
                [
                  m('.mdc-button__ripple'),
                  m('.mdc-button__touch'),
                  m('span.mdc-button__label', [
                    m(
                      'span.mdc-button__icon.material-icons',
                      { 'aria-hidden': 'true' },
                      'play_arrow',
                    ),
                    'Start game',
                  ]),
                ],
              )
            : undefined,
        ],
      ),
    ]);
  },
};

const ROLE_TEXT: { [status: string]: string } = {
  player: 'Ready to play.',
  spectator: 'Spectating',
};

function UserItem(user: WaitingAreaUser) {
  return m(
    'li.mdc-list-item.sk-room-list-room',
    { class: 'sk-room-user-' + user.role },
    [
      m('span.mdc-list-item__graphic.material-icons', {
        'aria-hidden': 'true',
      }),
      m('span.mdc-list-item__text', [
        m('span.sk-room-name.mdc-list-item__primary-text', user.name),
        m(
          'span.sk-room-status.mdc-list-item__secondary-text',
          ROLE_TEXT[user.role],
        ),
      ]),
    ],
  );
}
