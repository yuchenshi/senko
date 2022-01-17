import m from 'mithril';
import { Observable, Subscription } from 'rxjs';

interface SubscribeAttrs<V, T extends m.Children> {
  observable: Observable<V>;
  mapper: (v: V) => T;
}
class Subscribe<V, T extends m.Children>
  implements m.ClassComponent<SubscribeAttrs<V, T>> {
  private _subscription: Subscription;
  private _value?: V;
  private _hasValue: boolean = false;
  constructor(vnode: m.CVnode<SubscribeAttrs<V, T>>) {
    this._subscription = vnode.attrs.observable.subscribe(children => {
      this._value = children;
      this._hasValue = true;
      m.redraw();
    });
  }
  [_: number]: any;
  onremove() {
    this._subscription.unsubscribe();
  }
  view(vnode: m.Vnode<SubscribeAttrs<V, T>>): void | m.Children {
    if (!this._hasValue) return;
    return vnode.attrs.mapper(this._value!);
  }
}
export function rxm<V, T extends m.Children>(
  observable: Observable<V>,
  mapper: (v: V) => T,
) {
  return m<SubscribeAttrs<V, T>, {}>(Subscribe, { observable, mapper });
}
