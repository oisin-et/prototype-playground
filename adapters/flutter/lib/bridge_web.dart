// The prototype-playground kit: the playground bridge on the web. web/playground.js
// sets up `window.playgroundBridge` when the app runs in the playground page's
// frame, and passes JSON strings both ways.

import 'dart:js_interop';

@JS('playgroundBridge')
external _Bridge? get _bridge;

extension type _Bridge(JSObject _) implements JSObject {
  external bool get embedded;
  external void post(JSString message);
  external void listen(JSFunction onMessage);
}

bool get embedded => _bridge?.embedded ?? false;

void post(String message) => _bridge?.post(message.toJS);

void listen(void Function(String data) onMessage) =>
    _bridge?.listen(((JSString data) => onMessage(data.toDart)).toJS);
