# Host ↔ app messages

The playground page (`kit/src/host.js`) runs the app in an iframe at `<app origin><app.path>?playground=<host origin>`. They talk with `postMessage`, sending JSON strings. Each side checks the other's origin. The app sends only to the host origin named in its URL, and only when it's in a frame.

## Host → app

| Message | Meaning |
|---|---|
| `{type: 'layers', layers: ['<screen>/<exploration>/<version>', …]}` | The versions to run, in `index.json` order. The app redraws, laying each one's builder for a screen over the one before it, then reports `where` again. |
| `{type: 'show', screen}` | Open that screen (its id in `screens.json`). |
| `{type: 'capture', id, rect: {x, y, w, h}, scale}` | Draw that part of the app (in its CSS or logical pixels) at `scale` and answer `captured`. |
| `{type: 'inspect', id, x, y}` | Name the part of the app at that point, for a note, and answer `inspected`. |

## App → host

| Message | Meaning |
|---|---|
| `{type: 'hello', versions: {'<id>': ['<screen>', …]}}` | The versions compiled in, and the screens each changes. Sent at start and after every hot reload. The host answers with `layers`. |
| `{type: 'where', screen, params, title?}` | The screen on show. `params` tells its states apart, and `title` overrides the header's. |
| `{type: 'captured', id, png, note}` or `{type: 'captured', id, error}` | A capture: base64 PNG, and a note naming what it covers. |
| `{type: 'inspected', id, box: [x, y, w, h], widget, location, text}` | What's at the point: its name, where it was built (`lib/x.dart:12`, or what the app knows), and its text. Just `{type, id}` if nothing is there. |
| `{type: 'key', key, down}`, `{type: 'zoomkey', key}`, `{type: 'wheel', x, y, dx, dy}`, `{type: 'paste', text, images}`, `{type: 'pastekey'}` | Keys, zoom and pastes the app's frame swallowed, passed on to the playground. Each carries `from: 'page'`. |

## Server endpoints (`kit/serve.py`)

| Endpoint | |
|---|---|
| `GET /playground/app` | The app's state: `{state: starting \| waiting \| ready \| reloading \| stopped \| off, port, host, path?, kind, starting, log, last}` |
| `POST /playground/app/reload` `{restart}` | Writes the registry, reloads, and returns `{ok, message, errors, at, frame?}`. `frame: 'reload'` asks the page to load the app's frame again. |
| `POST /playground/picks` | Saves `picks.json`, if every pick names a known exploration and version. |
| `GET /playground/chat`, `POST /playground/chat`, `POST /playground/chat/stop` | The Claude panel. |

POSTs need the `X-Playground` header (`picks`, `reload` or `chat`) and a JSON body, from the server's own origin.
