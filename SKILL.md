---
name: prototype-playground
description: Put a playground around the project you have open, or run one that's there. The playground runs the app in the browser under a strip of its versions and between two panels. Explorations, the strip across the top, lays each screen's versions out step by step to try live while the app keeps its state, and to pick for the team. Files, on the left, is the project's folder as VS Code shows it, live, beside a Library tab: the app's components, with pictures, everywhere each is used, and an Inspect mode that names what's under the pointer. Claude, on the right, is a chat that makes new versions. Works with Flutter apps and web apps (React, Vite, Next, plain). Use when someone asks to set up, add or open a playground or prototype playground, run the playground, try or compare versions of a screen or a component, set up or check the app's component library, ask Claude for versions from inside the app, pick a version, or move a picked version into the app.
---

# Prototype playground

A playground wraps the user's own app. `serve.py` starts the app on its own port and shows it in a frame on a canvas, under a strip and with two floating panels:

- **Explorations**, the strip across the top, follows the screen on show: main, then each exploration's steps in a row (4.0, 4.1, 4.2 …). Hovering a step shows its picture and note. The person can star versions (and show only starred ones), and delete those they won't use. The screen's button at the left opens every screen, what's ready for main and what's starred.
- **Files**, on the left, is the project's folder as VS Code's explorer shows it: what's behind the screen on show, what git sees changed, or everything, with git's marks, a glow on whatever has just changed (Claude's work shows as it happens) and a reader.
- **Library**, Files' second tab, is the app's component library: each component's entry, its picture and specimens, everywhere the app uses it (instances, a screen's own copies, copies and look-alikes), and its explorations. **Inspect** (I) outlines the component under the pointer and says what it is.
- **Claude**, on the right, is a chat that makes versions. Up to four chats can work at once.

Clicking a version swaps it into the running app without a restart. **Use this version** makes it the pick.

The skill brings no project of its own. It works on the project that's open: the current working directory, or the repo the person names. The playground's code is the **kit** (`kit/`, the same in every project). An **adapter** (`adapters/flutter/` or `adapters/web/`) is the bridge the app uses to talk to it. `PROTOCOL.md` has the messages between them.

## 1. Find the project

1. Work in the project that's open. If the working directory isn't an app (no `pubspec.yaml`, no `package.json`, no `index.html`), ask which project to use, or ask the person to open it.
2. If `playground/playground.json` exists, the project has a playground: go to **Run it**. If its `playground/.kit-version` is older than this skill's commit (`git -C <this skill> rev-parse --short HEAD`), offer to update it: `python3 <this skill>/scripts/setup.py <project> --update`.
3. Otherwise, offer to set one up (**Set it up**).

Read the project's CLAUDE.md (or AGENTS.md) first and follow it throughout.

## 2. Set it up

Do it in this order, and tell the person what you're doing.

1. **Ask where the playground lives in git.** This is the person's choice. Ask:
   - **Committed:** the team runs it too. The playground files go in a normal commit.
   - **Local only:** keep it out of every commit and PR. Suggest a local branch with one "do not merge" commit for the playground, or a `.git/info/exclude` entry. If the repo has a PR check, make it fail on the playground's paths.
2. **Pick the adapter.**
   - `pubspec.yaml` with Flutter → `flutter`.
   - Anything served by a dev server or as static files (React, Vite, Next, Vue, Svelte, plain HTML) → `web`.
   - Anything else: say it isn't supported yet. A native-only app can't run in the frame.
3. **Run setup** from the project's top:
   ```sh
   python3 <this skill>/scripts/setup.py . --adapter flutter --name "App name"
   python3 <this skill>/scripts/setup.py . --adapter web --name "App name" --command "npm run dev -- --port {port} --host {host} --strictPort"
   ```
   - `--no-hot`, for a web app served as plain files with no reloading of its own: every reload then loads the app's frame again.
   - `--data` puts the explorations elsewhere. They must be inside the app's source so it compiles them; the defaults are `lib/playground` and `src/playground`.
   - `--port` and `--app-port` change the ports (8820 and 8821 by default). Pick free ones if another playground runs on this computer.
   - Setup writes `playground/` (the kit, `playground.json`, `RULES.md`, `templates/`), the data folder (an empty `index.json`, `picks.json` and `screens.json`, the registry, and the bridge), and the `.gitignore` lines. It never touches the app's own code.
4. **List the screens** in `<data>/screens.json`: one entry per screen the person would explore, by a short id. The entries are the app's top-level pages or routes, not every widget. Each entry has a `title` and the `file` its screen is drawn from. Flutter screens also need `type` and `build`, and web screens `export`. See the adapter's `HOOK.md`.
5. **Hook the app up** as the adapter's `HOOK.md` says. Keep the hook small, guarded so it does nothing outside the playground (`kIsWeb` and the bridge's own check), and marked with a comment pointing at `playground/README.md`.
   - Flutter: wrap each screen in the playground's `page`, attach `show` and `where`, report navigation, and put `wrapRoot` in `MaterialApp.builder`.
   - Web: the same, through `bridge.js`. For React, add the `Screen` wrapper.

   If you can't find one place that decides which screen shows, ask before restructuring anything.
6. **Write `playground/RULES.md`**: the project's rules for Claude in the chat. Cover its tokens and how a version uses them, what a builder returns in this project, and anything a version must not touch. Take them from the project's CLAUDE.md and code. Keep it short: the kit's rules already cover the playground itself.
7. **Start the component library** (offer it; the playground works without one). See `kit/README.md`, "The component library".
   - Add `"library"` to `playground.json`: `"dir"` (`library/` by default), `"primitives"` (the basic parts, counted but not listed), `"scan"` (where the app's screens place components: node trees as `{"kind": "json", ...}`, source as `{"kind": "code", "pattern": ...}`) and `"define"` (the files and patterns where the app defines its renderers, so one that's defined but not yet placed isn't taken for new).
   - Run `python3 playground/library.py` to see what's drawn, then write an entry in the library folder for each component the person names (start with the few most used), as `"status": "draft"`. Entries are the person's: don't approve one.
   - Hook the app up for it, as the adapter's `HOOK.md` says: `data-component` (and `data-pg` for shared parts) on what each component draws, so the Library can ring it and Inspect can name it; `draw()` in `attach`, for specimens; and `component()` / `part()` where the app picks what draws a node, for component explorations. Web only for now: in a Flutter app the Library lists and scans, but can't ring, picture or inspect.
8. **Check that it works** (see "The fidelity bar"). At least: the app loads in the frame, the header lists the screens, **Show this screen** opens each one, and a first exploration works end to end. Make that exploration with `new.py <screen> "Name"`, change something visible, then **Reload app**, try it, **Use this version**, and **Back**. Then delete that test exploration unless the person wants to keep it.
9. Commit the result according to step 1. Never commit explorations, `index.json` entries for them, or `picks.json` changes unless the person asks.

## 3. Run it

1. From the project's top: `python3 playground/serve.py --open`, or double-click `playground/Open playground.command`. If the port is taken, check with `lsof -nP -iTCP:<port> -sTCP:LISTEN`: it may already be running, and `--open` then just opens it.
2. The first start of a Flutter app takes about a minute. A web app is up when its dev server is.
3. To open straight on a version: `http://localhost:<port>/?playground=<screen>&v=<version>`.
4. Chat is on whenever `serve.py` finds Claude Code. `--model sonnet` picks the model, and `--no-chat` turns it off. When chat can't run, the panel itself shows the fix with a Copy button, so point the person at the panel.

Don't start `claude -p` yourself to test chat: a Claude Code session may not be allowed to start another agent. Test the panel with a stand-in that prints stream-json (set `PLAYGROUND_CLAUDE` to it), and leave the real run to the person.

Tell the person the URL and how to use it:
- go to a screen, and its versions line up in the Explorations strip across the top;
- hover a step to see it, click it to try it;
- **Use this version** to keep it, **Back to …** to drop the trial;
- describe an idea in the Claude panel to have it made.

## 4. Add a version of a screen

Explorations go wide, and each one's iterations follow it step by step. Each screen's versions are in `<data>/<screen>/versions.json`: exploration 4 is `v4.0`, and its iterations are `v4.1`, `v4.2` …, each copied from the one it builds on (`"from"`). The person says "exploration 4", "version 4" or "4.2".

1. Decide which of three it is, by what it means for the design. An **update** is a change nobody would want to go back from (a few pixels, a word, a token, a bug): make it in the version on show, in place, and add a line to its note, unless that version is starred, picked, merged or copied from. An **iteration** is a step someone could compare and prefer either way, still the same idea: `python3 playground/iterate.py <screen> <version> "Name"` makes the next number along its row. An **exploration** is a different answer to what the screen is for: `python3 playground/new.py <screen> "Name"` copies main (the app's own file for the screen, with a version file from `playground/templates/`), and `--from <version>` takes a version in a new direction. Torn between two, make the iteration.
2. A playground from before the numbering (`<data>/<screen>/<topic>/v1`) moves over once with `python3 playground/migrate.py`, then `--apply`; `setup.py --update` says when it's needed.
3. Change only the new version's folder. A version maps each screen it changes to a builder that gets `below` (the screen under it) and `app` (the app's own screen). Wrap `below` for a small change, or draw the copy for a big one. To change a part the screen uses, copy that part's file into the version folder too.
4. Write what it changes in the version's `note` in `versions.json`, in one or two plain sentences.
5. Never edit `default/` or another version. Versions don't share files, so an idea can be picked up again later.
6. `python3 playground/reload.py`, then fix any errors. Open `?playground=<screen>&v=<version>`, tap through every screen the version touches and the paths in and out of them, and check the console.

## 5. Design with the library

When the project has a library, Claude's chat rules already say how to use it; follow the same order when you make a version yourself.

1. Read it first: `python3 playground/library.py --brief`.
2. Use what's there as it is. Never a second component for the same job, a copy of a shared part, or a look-alike. Colours, sizes and type come from the project's tokens.
3. When nothing fits, propose a component: write its entry, with what it's for and what it came from, as `"status": "proposed"` in the version's own `library/` folder. The Library lists it under Proposed by versions, and **Commit** moves a picked version's proposals into the library as drafts.
4. After each reload, run `python3 playground/library.py --check <screen> <version>`. It compares the version with main and flags new components without an entry, look-alikes, raw colours and copies of shared parts. Fix them, or say why one stays. The strip's card for each version shows the same check.
5. To change one component everywhere it's used, make a component exploration: `python3 playground/new.py --component <id> "Name"`. Its versions replace the component's renderer (`components`) or shared part (`parts`), and every screen that uses it shows the change.

## 6. Pick a version, and move it into the app

- "Make it the real thing" in the panel means **Use this version**, and the person picks. Change `<data>/picks.json` by hand only when asked, and only with names from `index.json` and the screen's `versions.json` (`serve.py` refuses anything else).
- Explorations stay on the person's computer unless they decide otherwise. A commit makes something the team's.
- **Commit**, at the top right of the playground's header, moves the picks into the app and commits them locally, without pushing (`kit/README.md`, "Commit to main"). If the project's screens are written by scripts, list them in `playground.json`'s `"commit": {"allow": [...]}` so the move can run them, and in `"commit": {"build": [...]}` so Commit runs them after every move.
- **To move a picked version into the app** by hand (only when the person says it's settled):
  1. Copy its changes over the app's own files, following the project's conventions (tokens, no hard-coded values). Move the design, not the version's baggage: one copy of any part used twice, only the assets it uses (copied into the app, never a link outside the project), none of its history comments or version-numbered names, and no file over the project's limit (`"commit": {"maxFileMB": …}`, 5 MB by default).
  2. Set the pick back to `default`, which now shows the moved design.
  3. Keep the version folder as the record.
  4. Commit only the app's files. If the project has its own flow for design changes (a PR skill, a PR check), use it.

## Stars and deletes

These are the person's, in the Explorations strip, to keep it tidy (`kit/README.md`, "Star and delete").

- A star is `"starred": true` in the exploration's `versions.json`: at the top for the exploration, on a version's entry for a version. Leave stars as they are, and never set one unless the person asks.
- A delete moves the folder to `playground/trash/<time>/`, with a `deleted.json` saying where it was. Git ignores the trash, and `serve.py` clears it after 14 days. The toast's **Undo** puts it back; to restore one later, move the folder back and re-add its `index.json` or `versions.json` entry from `deleted.json`.
- Don't delete explorations or versions yourself unless the person asks. When they do, use the strip's route (`POST /playground/explorations`) or do what it does, so the pick, the registry and the versions copied from it stay right.

## The playground look

Every playground uses the same look and motion, after React Bits' Stepper. It's in the kit, so a playground set up with `setup.py` has it already. Don't restyle it unless the person asks. Anything new added to the panels, header or bar must use the kit's variables (`--frame`, `--tile`, `--well`, `--spring`, `--panel-radius` 20, `--well-radius` 12, `--tile-radius` 8), not new values.

- **Layout.**
  - The header holds only what every playground has: the name, the screen picker, the window size and Reset. The app's own controls sit in a bar under it, as a recessed well.
  - Explorations is a frosted strip under the bar, the page's full width: the screen's button, the steps in a well that scrolls sideways, and the trial's actions at the right. Explorations go across, and each one's iterations go across inside it, joined by a line; the strip never grows into columns.
  - The panels are floating cards with 20 px corners, 8 px from the strip and the window edges, never covering the header, the bar or the strip.
  - Files is 320 px wide and Claude is 380 px. Each minimises to a 44 px strip and is open by default. The reader opens between Files and Claude, over the canvas, as Studio's does.
- **The canvas.** The app sits on a canvas behind both panels.
  - It opens at 100%, centred between the panels, and stays centred while they spring open and shut, until the person pans or zooms.
  - Zoom with ⌘+ / ⌘− / ⌘0 / ⇧1, a pinch, ⌘-scroll or the zoom pill.
  - Pan by scrolling, by dragging, or with Space and a drag.
  - The view is kept per browser.
- **Colours.** Dark greys, accent blue `--accent` #25c3ff for what's running, primary buttons and Claude working, and amber `--amber` #f0b44c for a version being tried.
- **Motion.** Everything springs on `--spring` (about 560 ms):
  - the glider under the running step, springing along the strip;
  - panels to their strips;
  - a new screen's steps sliding in;
  - the trial's buttons rising in;
  - the chats row's tile and conversations.

  With `prefers-reduced-motion`, everything just appears.

## The fidelity bar

A playground isn't done until all of this works. Check by measuring and clicking, not by eye. Headless Chrome with the DevTools protocol can do it without a person.

- **Panels and layout:** both panels open at first and minimise to strips, and <kbd>P</kbd> toggles both. The page works at phone width and with reduced motion.
- **Trying and picking:**
  - trying a version keeps the app's state;
  - **Back to …** and **Use this version** sit at the right of the strip;
  - picks save to `picks.json` (or to the browser, with a warning, when the server can't write them);
  - the strip follows the screen on show: main, then each exploration's steps across (4.0, 4.1, 4.2 …), the running one on the glider, scrolled into view;
  - hovering a step shows its picture and note under it, with its star and bin, and stays while the pointer is on it; its picture is taken (and taken again after a reload) once it has been on screen;
  - starring a version survives a reload, and **Starred only** hides the rest;
  - deleting a version, or an exploration with its iterations (the picked one too), asks first, takes it out of the app and the picks, and **Undo** puts it all back.
- **Files:** On show lists the screen's file and the running version's folder; Changed lists what git sees; All files is the folder, folders first, with git's marks and ignored files dimmed; Find narrows by every word; a file changed on disk (by Claude or anyone) glows within a few seconds, and so do the folders above it; clicking a file opens the reader (Markdown as a document with Preview/Source, code as numbered lines, links between files followed), which follows it as it changes; nothing outside the project can be read.
- **Explorations and iterations:** a change asked for in the chat makes the next iteration of the version on show (4.2 → 4.3), a new idea makes the next exploration, and both scripts refuse what doesn't fit (iterating on main).
- **The app's bridge:**
  - the screen picker opens every screen;
  - the header follows navigation inside the app;
  - ⌥-drag captures part of the app with a note naming what it covers, and N-notes outline what's under the pointer;
  - ⌘+, P, Esc and pastes reach the playground while the app has the focus.
- **Pasting, every time:** a paste or ⌘V (how dictation apps like VoiceInk type) lands in the chat box **once, the first time**, wherever the focus is: in the box, on the page or a button, in the app, while the app reloads after a new version, and while the app reloads itself (a dev server's full refresh, a sign-in redirect: the web bridge sends `leaving` and the page takes the focus). A dictation app puts the old clipboard back straight after its ⌘V, so test that too: nothing old may follow the text. Never rely on reading the clipboard (it can ask permission and returns the old clipboard): the page moves the focus to the chat box on ⌘V, and the web bridge catches the paste in a hidden box in the app. Testing a real ⌘V needs a visible Chrome window (focus emulation, ⌘V sent with the `paste` command), so ask before opening one, and close it by its profile folder as soon as the test ends.
- **Reloads:**
  - a changed version shows after **Reload app**;
  - a new version is picked up (Flutter: a hot reload; web: the frame reloads, and the playground goes back to the same screen);
  - while a chat works, the app on screen doesn't reload or switch, its new version is locked in the strip, a progress card over the chat box follows each request (amber while fixing an error, red if it stops), and **View it** (card and toast) puts the version on when the run is done, leaving a line with **View** in the chat;
  - a broken version shows its errors in the bar.
- **Chat**, tested with a stand-in `claude`:
  - sending, the steps streaming in, a new version tried as it appears;
  - two chats at once, stopping one, closing one by its number;
  - a fifth run refused.
- **Library**, when the project has one: the list matches `library.py`; a component's page shows its picture, specimens and uses, and a use rings the component in the app (going to its screen first); Inspect names the component under the pointer, ↑ and ↓ move out and in, and a click opens its page; a component exploration shows on every screen that uses it; each version's card shows its check.
- **No console errors** in the page or the app.

Fix anything that falls short before you report the work done, and say what you checked.

## Changing the kit

The kit and the adapters are this skill's files, shared by every project. Fix a bug or add a feature here, not in one project's copy. Then run `setup.py <project> --update` on each project, which keeps their config, rules, templates and explorations. Keep the kit free of anything about one project: what differs goes in `playground.json`, `RULES.md` or `templates/`.
