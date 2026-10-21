# Hooking a Flutter app up to the playground

`setup.py --adapter flutter` copies the bridge into the project: `playground.dart`, `version_api.dart`, `bridge_web.dart` and `bridge_stub.dart` go in the data folder (`lib/playground/` by default), and `playground.js` goes in `web/`. Then the app needs a small hook. Everything in it is behind `kIsWeb`, and the bridge does nothing unless the app runs inside the playground's frame. The desktop and mobile builds are unchanged.

Find the widget that owns navigation: the `State` that decides which screen shows. It's often the app's root or its shell. Then add these six things:

1. **Load the bridge on the web.** In `web/index.html`, before `flutter_bootstrap.js`:

   ```html
   <!-- The playground bridge (playground/README.md). -->
   <script src="playground.js"></script>
   ```

2. **Attach in `initState`.** `show` opens a screen by its id in `screens.json`. `where` says which screen is on show, plus anything that tells its states apart. It can also return a `title` for the header.

   ```dart
   import 'playground/playground.dart'; // The playground (playground/README.md)

   if (kIsWeb) {
     Playground.instance.addListener(_onPlayground);
     Playground.instance.attach(
       show: (screen) => _open(Screen.values.byName(screen)),
       where: () => {'screen': _current.name, 'params': {'tab': _tab}},
     );
   }
   ```

3. **Wrap each screen** where it's built. The id is its key in `screens.json`:

   ```dart
   Widget _pg(String screen, Widget page) => kIsWeb
       ? Builder(builder: (context) => Playground.instance.page(context, screen, page))
       : page;

   // …
   _pg('settings', SettingsPage(user: _user)),
   ```

4. **Redraw when the versions change**, and stop listening in `dispose`:

   ```dart
   void _onPlayground() { if (mounted) setState(() {}); }
   // dispose(): if (kIsWeb) Playground.instance.removeListener(_onPlayground);
   ```

5. **Report every navigation**, wherever the screen on show changes: `if (kIsWeb) Playground.instance.report();`

6. **Let captures draw the app.** In `MaterialApp.builder`, wrap the child:

   ```dart
   builder: (context, child) => kIsWeb ? Playground.instance.wrapRoot(child!) : child!,
   ```

   If the builder already wraps the child (in a theme scope, say), put `wrapRoot` innermost.

## screens.json

One entry per screen. `duplicate.py` uses `file`, `type` and `build` to copy a screen into a version. `build` constructs the copy from the original widget `o`, passing on each of its constructor arguments:

```json
"settings": {"title": "Settings", "file": "lib/ui/settings_page.dart", "type": "SettingsPage",
  "build": "SettingsPage(key: o.key, user: o.user)"}
```

## Things to know

- **No import cycles.** The versions, `registry.g.dart` and `playground.dart` must not import each other in a circle (`version_api.dart` is what breaks the circle). If they do, the web compiler bundles them into one module, and a fresh page load can run the old registry.
- **Keep `version` a getter** in each version, so a hot reload sees changes to it.
- **The app runs in debug** (`flutter run -d web-server`). That's how notes can name the file and line that built a widget.
