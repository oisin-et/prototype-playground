# Playground

The playground is where the app's screens are explored in versions, inside the running app. It comes from the prototype-playground kit, which is the same in every project. What's particular to this project is in `playground.json` (name, ports, where the explorations live, how the app starts) and `RULES.md` (its rules for Claude). Don't change the kit's files here: change the kit and run the skill's `setup.py --update`.

## Run it

From the top of the project:

```sh
python3 playground/serve.py --open
```

Or double-click **Open playground.command** in this folder. It opens `http://localhost:<port>` (the `port` in `playground.json`). `serve.py` starts the app on its own port and keeps it running: a Flutter app with `flutter run -d web-server`, a web app with its dev server (`app.command`). The page shows the app once it's ready. Stop it with <kbd>Ctrl</kbd>+<kbd>C</kbd>, which stops the app too.

The app sits on a **canvas**. Across the top, under the bar, runs the **Explorations strip**, and two panels float over the canvas, one on each side:

- **Explorations, the strip across the top,** follows the screen on show. It starts with **main** (the app as it is), then lays out each exploration side by side: its number and name, and its steps in a row, **4.0**, **4.1**, **4.2** … joined by a line. The running step rides on a raised tile that springs along the strip: blue for the pick, amber for a version being tried. Long strips scroll sideways, and the running step is kept in view.
- **Explorations and iterations.** An exploration is one direction for the screen, numbered 1, 2, 3 … An iteration is a step further along one: exploration 4 starts at **4.0**, and its iterations are **4.1**, **4.2** … each copied from the one it builds on. Going back to exploration 2 and carrying on makes 2.1, and so on.
- **Hover a step to see it.** A card under it shows its picture and what it is: its number, name, date, what it came from and its note, with its star and its bin. It stays while the pointer is on it. The picture is taken whenever the version is on its own screen (after every reload too, so it follows the version as it changes) and kept in `playground/thumbs/`, which git ignores. A version that has never been on screen says so. `"preview"` in `playground.json` names the element to picture, as a CSS selector (`"#screen"`); without it, the whole app is. With a step focused, <kbd>S</kbd> stars it and <kbd>Delete</kbd> deletes it.
- **The screen's button,** at the left of the strip, names the screen on show and what it holds. It opens a card with **Ready for main** (every pick, across the screens), **Starred**, and every screen; press a screen to go there, or a starred version to try it.
- **Stars and deletes** keep it tidy (see "Star and delete").
- **Files, on the left,** is the project's folder, one for one, the way VS Code's explorer shows it. **On show** is the files behind the screen on show: the file it's drawn from, the folder of each version running on it, the versions Claude is building and the screen's `versions.json`. **Changed** is what git sees changed since the last commit, and **All files** the whole folder. **Find a file** narrows any of them. git's marks are on every row (M changed, U new, A added, D deleted, a dot on a folder with changes inside), what git ignores is dimmed, and the playground's own files say what they are. It follows the folder every few seconds, whoever changes it: a file that has just changed glows, and so do the folders above it, so you can watch Claude work. Click a file to read it between the panels, as in Studio: Markdown reads as a document (its front matter as a small table, **Source** a click away), code as numbered lines, prose wrapped, pictures with their size, and a link to another file opens that file. Under the name are its size, when it changed, its lines and what git says of it. The reader follows the file as it changes; **Copy path**, **Show in folder** and **Open** (in VS Code) sit in its header. Files only reads, and never outside the project.
- **Library, the other tab on the left** (beside Files), is every component the app is built from, from `library.py`'s scan: the ones with an entry by status (approved, pending, draft), then what's drawn without an entry yet, the primitives and the raw colours. Each row says how often it's used and flags what's out of step: own copies or copies built differently from the shared part (they may still look the same), and look-alikes. Click one to open its page where the reader opens: what it's for and its rules, what draws it on each platform, its axes, tokens, behaviour and where it came from, and where it's used by screen. Click a screen, or a use, to go there: the page steps aside and the app rings each one for a moment. **Show on screen** rings it on the screen on show. It scans again when you open it, after files change, and with ↻. **Every component has a picture,** so it's known at a glance: whenever a screen is on show, the app cuts one of each component on it from one drawing of the page (once a session), kept in `playground/thumbs/_library/` (git ignores it). **Take pictures** visits the screens with components still without one and comes back; **Take it again** on a component's page retakes its own. A component in a part of a screen that isn't open (a closed sheet, another page) can't be pictured until it's in view. **A component's page shows it side by side,** drawn on its own by the app's own code: under **States**, the named states its entry lists (`"states": [{"name", "props", "size": [w, h]}]`); under **As used**, up to a dozen different ways the app really sets it up (its props, or a part's `with`, and its size), taken in turn from each screen and part it's on. Click one to see it in place. It needs the app's hook to have `draw()` (the adapter's HOOK.md).
- **Component explorations** change one component wherever the app draws it, on every screen at once, the way a change to a main component reaches its instances in Figma. `python3 playground/new.py --component <id> "Name"` starts one (`<id>` is an entry's id, or the name of a component without an entry; `library.py` lists them) in `<data>/component-<id>/`, and `iterate.py component-<id> <version> "Name"` iterates. Its version file exports `{components: {<renderer>: (ctx) => …}, parts: {<part>: (ctx) => …}}` instead of `pages`: `ctx.below` is what draws it under this version and `ctx.app` the app's own, and a builder returns one of the same kind. The first version lists the component's names, each left as it is, and its look-alikes, commented out, ready to be drawn by it. Its explorations show in the strip on every screen the component (or a look-alike) is on, after the screen's own and tagged with the component's name, and on its page in the Library; trying one changes it everywhere. The app's hook asks for it with `component(name, renderer)` and `part(name, tree)` (the adapter's HOOK.md). Commit moves a picked one into the component's own code, once.
- **Claude designs with the library.** When the project has a `"library"`, the Claude panel reads `python3 playground/library.py --brief` before it builds (each entry, what it's for and what draws it, and the most-used components without one) and looks in order: the project's library (used as it is: never a second component for the same job, a copy of a shared part, or a look-alike), then the folders it may read (to adapt), then references (for ideas). When nothing fits, it **proposes** a component: an entry with `"status": "proposed"` in the version's own `library/` folder, listed in the Library under **Proposed by versions**; Commit moves a picked version's proposals into the library folder as drafts, for you to review.
- **Every version is checked against the library.** `python3 playground/library.py --check <screen> <version>` says what the version brings in, compared with main, that's out of step: a component with no entry or proposal, a look-alike of an entry, a colour that isn't a token (and isn't in main already), or a copy of a shared part. Claude runs it after every reload and fixes what it finds, and a version's card in the strip shows it (**In step with the library**, or what's out of step). `"define"` in `"library"` (`{"files": [...], "patterns": [...]}`, each naming a renderer as `(?P<name>…)`) tells it where the app's code defines its renderers, so one the app has but no screen places isn't taken for new.
- **Inspect** (in the bar, or <kbd>I</kbd>) is the playground's dev mode: the app stops taking the pointer, and hovering it outlines the library component under the pointer, with a card that says what it is: its picture, name and status, what kind of use it is (an instance, the screen's own copy of a part, a copy, a look-alike or a primitive, the out-of-step ones outlined in amber), the parts it sits in, its size and node, the tokens its drawing uses with their values, and any colour written out instead of a token. <kbd>↑</kbd> and <kbd>↓</kbd> move out to the part it's in and back. A click opens its page in the Library. <kbd>I</kbd> or <kbd>Esc</kbd> stops; Inspect and note mode turn each other off.
- **Claude, on the right,** is the chat (see "Ask Claude for a version").

Both panels are open at first. Each minimises to a strip at its edge, and <kbd>P</kbd> minimises or expands both, even while the app has the focus.

**The canvas** holds the app's window the way a Figma canvas holds a frame. It opens at 100%, centred between the panels, and stays centred until you move it.
- **Zoom:** <kbd>⌘</kbd><kbd>+</kbd>, <kbd>⌘</kbd><kbd>−</kbd>, <kbd>⌘</kbd><kbd>0</kbd> (100%), <kbd>⇧</kbd><kbd>1</kbd> (fit between the panels), a pinch or <kbd>⌘</kbd>-scroll, or the zoom pill.
- **Pan:** scroll over the canvas, drag around the app, or hold <kbd>Space</kbd> and drag anywhere.

**Trying and picking:**
- **Click a version to try it.** It runs at once on the same screen, and the app keeps its state.
- **While you try one,** **Back to …** and **Use this version** sit at the right of the strip.
- **Use this version** makes it the pick, saved to `<data>/picks.json`.
- **Links:** `?playground=<screen>&v=v4.2` opens trying that version, and `#/<screen>` opens on a screen.

**The header** has the screen picker, the window size (the sizes in `playground.json`; `"zoom": "fit"` there opens the window fitted between the panels instead of at 100%), **Reset**, which starts the app again, and, at the top right, **Commit** (see "Commit to main"). **The bar** under it has **Reload app**, the app's status, **Inspect** (see the Library), any errors from the last reload, and **Open the app alone ↗**.

**The look and motion** are the kit's, after React Bits' Stepper: frosted cards, raised tiles, recessed wells, and spring motion. New parts use the variables in `src/style.css` (`--frame`, `--tile`, `--well`, `--spring`). With reduced motion set, everything just appears.

## Star and delete

A version's star and bin are in its card, under its step. A starred step has a small star on its corner. An exploration's bin is beside its name in the strip, and shows when the pointer is on it: it deletes the exploration with all its iterations.

- **Star** what's worth keeping. Everything starred is listed under **Starred** in the screen button's card, and a starred version is tried at once from there. A star is kept in the screen's `versions.json` (`"starred": true`), so it stays when the playground reloads.
- **Starred only,** the star at the right of the strip, hides everything without a star: just the starred versions show, with the versions they were copied from, main, the pick and any trial. **Show all** turns it off. It's kept in this browser.
- **Delete** what you won't use. It asks first (<kbd>⇧</kbd>-click doesn't), then moves the folder to `playground/trash/`. A deleted version's copies stay, joined to the version it came from. If it was the pick, the screen goes back to main. The app reloads without it, and **Undo** in the toast puts it back. The trash is kept for 14 days, and git ignores it. main can't be deleted: it's the app.

Deletes wait while a commit is running.

## Ask Claude for a version

Chat is on whenever `serve.py` finds Claude Code: on the PATH, in its usual install folders, or inside the VS Code, Cursor or Windsurf extension. `--model sonnet` picks the model, and `--no-chat` turns chat off. When chat can't run, the Claude panel shows the one step that fixes it.

Describe a version in the Claude panel and press Enter.

- **Claude Code runs on this computer** (`claude -p`, headless), with your own login, in the project.
- **An update, an iteration or an exploration: Claude judges which.** Each message is one of three, by what it means for the design rather than how big the edit is:
  - **An update** changes the version on show in place, with no new number: a few pixels, a word, the right token, a bug, anything nobody would want to go back from. Its note gets a line saying so. A version that's starred, picked, merged or copied from is never updated: it gets an iteration instead.
  - **An iteration** is a step someone could compare side by side and prefer either way (something moved or resized enough to read differently, a control added or changed, new emphasis), still the same idea. `iterate.py` makes it: on show 4.2, it makes 4.3 (or the next free number in that column).
  - **An exploration** is a different answer to what the screen is for: another layout, focal point or way of working, or anything asked for as another way. `new.py` starts it from main, or from a version to take it in a new direction.

  The tests, in order: would anyone want the old one back? If not, update. Still the same idea? Iterate. If not, explore. Torn, Claude iterates. Name it ("just tweak it", "a new iteration", "a new exploration") and Claude does that. "Go back to 2" carries on from exploration 2.
- **Every step worth keeping is kept.** Iterations and explorations stay on the board to step back to; updates don't add to it. The card over the chat says which it was: **is ready** for a new version, **is updated** for an update, both with **View it**.
- **Claude starts each version from its copy.** It changes the copy, then runs `reload.py`, which checks the app and prints any errors, so Claude fixes them before it finishes.
- **Claude builds out of sight.** While it works, the app on screen is left as it is: it doesn't reload or switch, so you can keep using it. The version being made shows in the strip as a pulsing step (**Claude is building it…** in its card), locked until the run is done, and its folder is under On show in Files, where you can watch its files appear. A Flutter app's hot reloads, and a dev server's own reloads, still happen while Claude works, but the screen stays on the version you chose.
- **Every request shows how it's going.** From the moment you press Send, a card over the chat box has a progress bar and the time it's taken, and says what Claude is doing: looking at the app, building the version, checking it runs. It turns amber while Claude fixes an error it hit, and red if the run stops on one. When it's done the card says the version is ready, with **View it**, and a toast says so too (a web app with `"hot": false` loads its frame again at that point, once). The card stays until you view the version, dismiss it, or send the next request. A chat that isn't on show keeps its card, with an amber badge, until you open it.
- **Each request leaves a line in the chat:** what it built, how long it took, the errors fixed on the way and what it cost, with **View** to put that version on again later.
- **Claude knows what's on show:** the screen and its parameters, the file it's drawn from, and the version by its number. Say "exploration 4", "version 4" or "4.2" and it knows which.
- **Screenshots.** Hold <kbd>⌥</kbd> and drag over any part of the page, or press the capture button and drag. The app draws its part at twice its size, and the capture comes with a note naming the parts of the app inside it. You can also drag, paste or pick images of your own. They're saved to `playground/attachments/`, which git ignores.
- **Notes**, after [Agentation](https://www.agentation.com/):
  - Press <kbd>N</kbd>, then click a part of the app or drag over an area, and write a note. Mark it **Fix**, **Change** or **Question**.
  - Notes wait, pinned, until **Send** takes them all in one message.
  - Claude answers each note with **Done**, **Question** or **Skipped**, and the answer shows on its pin.
  - Notes stay on this computer (`playground/notes/`, which git ignores).
- **Paste and dictate straight in.** A paste or ⌘V goes into the chat box the first time, once, wherever the focus is: on the page, in the app, or while the app reloads. Dictation apps that put the old clipboard back afterwards (VoiceInk and the like) work too.
- **Run up to four chats at once,** with **+** at the top of the panel. Each chat is its own conversation and makes its own versions. Every chat shares the one app, so an error in one chat's version shows in every reload until it's fixed.
- **Close a chat** by pointing at its number and clicking the ×, or pressing Delete on it. A chat with a conversation asks first, with a red **Delete** and **Cancel** (⇧-click skips the question); an empty chat just closes. The versions a chat made stay in Explorations.
- **Claude is locked down.** It can read the project, write only under `<data>/`, and run only `new.py`, `iterate.py` and `reload.py`. Anything else is refused without asking, and your own Claude Code settings and MCP servers aren't loaded. Only the playground's own page can start a run.
- **Other folders it can read.** `"read"` in `playground.json` lists folders outside the project that Claude may read but never change, such as another app with the same features or a design library: `"read": [{"path": "../other-app", "about": "what's there and when to look"}]`. A path is from the project's top (or absolute). Claude is told each one's path and `about` on every message, and Commit's move can read them too. A folder that isn't there is left out, with a warning where the playground runs.
- **Design guides, Stageshow by default.** Claude follows a design guide's craft rules whenever it makes a version, wherever the project's own rules and CLAUDE.md are silent (the project wins where they disagree), and looks at each version as the guide's reviewer would before it reloads. Out of the box that's the Stageshow skill (by Benji Taylor) if it's installed (in the project's `.claude/skills/stageshow`, `~/.claude/skills/stageshow` or `~/.agents/skills/stageshow`): Claude reads its `SKILL.md`, `references/craft.md` and `references/review.md`, and uses its rules, not its kit. `"guides"` in `playground.json` sets your own, `[{"name": "…", "path": "…", "about": "how to use it", "read": ["files", "to read first"]}]`, and `"guides": []` turns them off. Claude may read a guide's folder but never change it.
- **"Use it" or "make it the real thing"** gets you pointed at **Use this version**: the chat can't pick for you.

## Start an exploration, or iterate on one

```sh
python3 playground/new.py <screen> "Name"                   # the next exploration, from main
python3 playground/new.py <screen> "Name" --from 4.2        # a new direction from a version
python3 playground/iterate.py <screen> 4.2 "Name"           # the next iteration of exploration 4, from 4.2
```

The screen must be one listed in `<data>/screens.json`; its first exploration starts its `versions.json`. A version is named by its number: `4.2`, `v4.2`, or `4` for 4.0. Each copies the version (or, from main, the app's own file for the screen, its `file` in `screens.json`, with a version file from `templates/`) and adds it to `versions.json` with today's date. Change the copy, write what it changes in its `note`, then press **Reload app** (or run `python3 playground/reload.py`).

A playground from before the numbering, with explorations by topic (`<screen>/<topic>/v1`), moves over once with `python3 playground/migrate.py` (it shows what it would do) and then `--apply`. Each version is renumbered by what it was copied from: one copied from main starts an exploration, and one copied from another is the next iteration of that one's.

## The component library

The library is every component the app is built from: what each one is, and everywhere the app uses it. It's what the Library tab shows, and what Claude will design with.

```sh
python3 playground/library.py           # the library, as a table
python3 playground/library.py --json    # the same as JSON
```

- **A component's entry** is a JSON file in the project's library folder (`library/` by default): its name, status (`draft`, `pending`, `approved`), purpose (what it's for, what it's not for, its rules), axes, tokens, behaviour, lineage (what it was adapted from or inspired by), and `implementations`, the code that draws it on each platform (a `renderer`, a shared `part` or a `widget`).
- **Uses are found, never written down.** `library.py` scans the app's files each time, so they can't go out of date. It finds instances, overrides (a screen's own copy of a shared part, placed instead of it), copies (a tree with most of a shared part's ids that doesn't place it), and look-alikes (names that match an entry's `"lookalikes"` patterns but aren't its implementations). An override or copy that holds different components from its part says what differs. It also lists what's drawn but has no entry yet, and counts raw colours (hex or `rgb()` where a token should be) by file.
- **`"library"` in `playground.json`** says where to look: `"dir"`, `"primitives"` (basic parts, counted but not listed) and `"scan"`, a list of `{"kind": "json", "files": [...], "parts": [...], "keys": {...}}` for node trees (`keys` names the component, use and screen's-own-parts keys: `component`, `use`, `fragments` by default) and `{"kind": "code", "files": [...], "pattern": "…(?P<name>…)…"}` for source code. Without it, nothing is scanned.

## How it works

```
playground/                  the page and its tools (the kit, plus this project's files)
  playground.json            this project: name, ports, data folder, how the app starts
  RULES.md                   this project's rules for Claude in the chat
  templates/                 how a copied screen becomes a version
  serve.py                   the server: files, the app, picks, stars and deletes, chat, commit,
                             and the Files panel's reads (/playground/files/…)
  trash/                     deleted explorations and versions, for 14 days (git ignores it)
  thumbs/                    each version's picture, for the preview on hover (git ignores it)
  index.html, src/           the page: host.js (the layers, the canvas, the app's frame),
                             playground.js (the strip and the panels), files.js (Files
                             and its reader), md.js (Markdown for the reader), style.css
  new.py, iterate.py         start an exploration, iterate on one
  migrate.py                 move topic folders to explorations and iterations, once
  reload.py                  reload the app and print its errors
  library.py                 the component library: entries and every use
  pglib.py                   what those share; writes the registry
<data>/                      the explorations, inside the app's source so it compiles them
  screens.json               the app's screens by id, with the file each is drawn from
  index.json                 every screen with explorations
  picks.json                 which version of each screen runs ("default" is the app as it is)
  registry.*                 generated: every version, by id (<screen>/v4.2)
  <screen>/                  one screen's explorations
    versions.json            its versions, oldest first, with "from", notes and stars
    v4.0/, v4.1/             exploration 4 and its first iteration: what each changes, and the files it copied
```

- **The page is the player.** `host.js` keeps the explorations, the picks and the version being tried. It tells the app over `postMessage` which versions to lay over its screens, and the app's bridge answers.
- **Every version is compiled in,** through the registry, so switching is instant and keeps the app's state.
- **A version maps each screen it changes to a builder,** which gets `below` (the screen under it: the app's own, or another running version's) and `app` (the app's own screen). It can draw its own copy or wrap `below`. When two picked versions change the same screen, the later one in `index.json` is laid over the earlier one, and the playground says so in a toast.

## Commit to main

**Commit**, at the top right of the header, makes the picks part of the app, for good. It turns blue with the number of picks once a version is picked. It opens a dialog that lists the picks, the branch the project is on, and any other changes nobody has committed, with a box for a note. Then **Commit**:

1. **Claude Code moves each picked version into the app's own files,** as in "Move a picked version into the app" below, following the project's conventions. It can write anywhere in the project apart from `playground/`, the explorations and `.git`. It runs only `reload.py`, plus whatever `"commit": {"allow": [...]}` in `playground.json` adds, in Claude Code's permission form. A project whose screens are written by scripts lists them, such as `"Bash(node tools/:*)"`.
2. **Generated files are written again.** `"commit": {"build": [...]}` in `playground.json` lists the commands that write them from their sources, run in order from the project's top: a project whose screens are written by scripts lists those scripts (`["node tools/screens.mjs"]`). A move that changes a script's source but not its output then can't leave the app showing the old design. A command that fails stops the commit.
3. **The app is reloaded and checked.** Nothing is committed, and the moved files are left as they are to fix, if:
   - the app has errors;
   - the move changed nothing (the picks then stay as they are);
   - or the move brought baggage: a link to a folder outside the project, or a file over 5 MB (`"commit": {"maxFileMB": …}` in `playground.json` changes the limit).

   The move is told to keep the design lean: one copy of any part used twice, only the assets it uses (copied in, never linked), and none of the version's history.
4. **Each pick goes back to main,** which now shows it (unless you picked another version of that screen while the commit ran), and its version is marked `"merged"` with the date in `versions.json`. The folder stays as the record.
5. **The files the move changed are committed** on this computer, in one commit, on the branch the project is on. It's made as your git user, and the message names each pick and its note. With **Also commit the other changes** ticked, everything else git sees changed goes in too. Nothing is pushed: `git push` shares it.
6. **Other branches keep in step,** if `playground.json` says so. A project worked on in a branch of its own (a worktree), but opened, shared or deployed from `main`, lists `"commit": {"keepInStep": ["main"]}`. Each commit then moves `main` up to it as well: in the folder that has `main` checked out, so its files follow, or just the branch otherwise. It's only ever a fast-forward. A branch with commits of its own, or a folder whose uncommitted changes are in the way, is left as it is, and the steps say so.

**It runs in the background.** Once you press **Commit**, the dialog closes and you carry on designing: trying versions, picking, and chatting with Claude all work while it runs. The header's button says **Committing…** with a bar along its foot that fills as the move, the check and the commit go by. Press it to see the steps, and close them again at any time. When it's done the button says **Committed** (or **Commit failed**) until you press it to see how it went, and a toast offers **Reload** to bring in main as it is now. Deletes wait until it's done, and leaving the page asks first (the commit carries on without it, but the page loses sight of it).

Explorations, `index.json` and `picks.json` are never committed. A commit can't start while a chat is working, and only the playground's own page can start it.

## Move a picked version into the app

**Commit** does this for you. To do it by hand, outside the chat, ask Claude Code to "move the picked <screen> version into the app". It copies the version's changes over the app's own files, following the project's conventions, sets the pick back to `default`, and keeps the version folder as the record.
