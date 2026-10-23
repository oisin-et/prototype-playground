# Hooking a web app up to the playground

`setup.py --adapter web` copies `bridge.js` into the data folder (`src/playground/` by default), next to the `registry.js` that `pglib.py` writes there. Then the app needs a small hook. The bridge does nothing unless the app runs inside the playground's frame. Opened on its own, `page()` returns the app's own screen.

## The dev server

`app.command` in `playground/playground.json` starts the app. `{port}` and `{host}` are filled in. The server must listen on exactly that host and port (so not `localhost`, which can resolve to IPv6). It must also serve the app at `app.path` (`/` by default) and keep the query string, because the bridge reads `?playground=` from it.

| Stack | `app.command` |
|---|---|
| Vite | `npm run dev -- --port {port} --host {host} --strictPort` |
| Next.js | `npx next dev -p {port} -H {host}` |
| Create React App | `BROWSER=none PORT={port} HOST={host} npm start` |
| Static files | `python3 -m http.server {port} --bind {host}`, with `"hot": false` |

A dev server reloads changed files itself. When the list of versions changes, the playground loads the app's frame again so the new registry is read. A server that only serves files, with no reloading of its own, needs `"hot": false` in `app`: then every reload loads the app's frame again, and the app starts from the beginning on the screen it was on. Nothing compiles the versions there, so each reload checks their files itself: JSON must parse, and JavaScript must pass `node --check` when Node is installed.

Each version is loaded on its own. One that doesn't load is left out, the app and the other versions still run, and the playground's bar names it. A builder that throws is passed over the same way.

## React

Add a wrapper that redraws a screen when the versions change:

```jsx
// src/playground/Screen.jsx
import { useSyncExternalStore } from 'react';
import * as pg from './bridge.js';

export function Screen({ id, children }) {
  useSyncExternalStore(pg.subscribe, pg.version);
  return pg.page(id, children);
}
```

Then attach once, report on navigation, and wrap each screen. The id is its key in `screens.json`:

```jsx
import * as pg from './playground/bridge.js';
import { Screen } from './playground/Screen.jsx';

// once, where the router is in reach:
pg.attach({ show: (id) => navigate(PATHS[id]), where: () => ({ screen: currentId(), params: {} }) });
useEffect(() => pg.report(), [location.pathname]);

<Route path="/settings" element={<Screen id="settings"><Settings user={user} /></Screen>} />
```

A builder gets `{ below, app }`, where `app` is the original element, so `ctx.app.props` holds its props. `templates/version.js` copies a screen this way. A builder can also return `<Wrapper>{ctx.below}</Wrapper>` to change a screen a little.

## Anything else

Vue, Svelte and plain JS work the same way. Call `attach` once, call `page(id, original)` wherever a screen is drawn, redraw when `subscribe` fires, and call `report()` on navigation. Then change `playground/templates/version.js` so it returns what the app's screens are (a component, a DOM node and so on), and say so in `playground/RULES.md`.

## screens.json

```json
"settings": {"title": "Settings", "file": "src/pages/Settings.jsx", "export": "default"}
```

`file` is what `duplicate.py` copies into a version, and `export` is the component's name in it. Its relative imports are pointed back at the files they named.

## Naming parts for notes

Notes and captures name the element under them by its `data-pg` attribute if it has one (`<section data-pg="Plan card">`), otherwise by tag, id and classes. Put `data-pg` on the parts people will comment on. Add `data-source="src/pages/Settings.jsx:42"` too if you want Claude to see the line.
