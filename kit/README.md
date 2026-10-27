# Playground

The playground is where the app's screens are explored in versions, inside the running app. It comes from the prototype-playground kit, which is the same in every project. What's particular to this project is in `playground.json` (name, ports, where the explorations live, how the app starts) and `RULES.md` (its rules for Claude). Don't change the kit's files here: change the kit and run the skill's `setup.py --update`.

## Run it

From the top of the project:

```sh
python3 playground/serve.py --open
```

Or double-click **Open playground.command** in this folder. It opens `http://localhost:<port>` (the `port` in `playground.json`). `serve.py` starts the app on its own port and keeps it running: a Flutter app with `flutter run -d web-server`, a web app with its dev server (`app.command`). The page shows the app once it's ready. Stop it with <kbd>Ctrl</kbd>+<kbd>C</kbd>, which stops the app too.

The app sits on a **canvas**, and two panels float over it, one on each side:

- **Explorations, on the left,** is the file manager. Every screen of the app is a folder, and the screen on show is pinned at the top. A folder holds that screen's explorations, and each exploration holds its versions. **Show this screen** takes the app there. The crosshair does the reverse: it opens the folder of the screen on show, scrolled to the running version.
- **The versions are drawn as a git graph,** as on GitHub. **main** is the app as it is (the default version, at the foot). Each exploration is a branch off it, and each version is a commit joined to the one it was copied from. The pick's line back to main is blue and a trial's is amber. **Ready for main**, at the top, gathers every pick.
- **Stars and deletes** keep it tidy (see "Star and delete").
- **Claude, on the right,** is the chat (see "Ask Claude for a version").

Both panels are open at first. Each minimises to a strip at its edge, and <kbd>P</kbd> minimises or expands both, even while the app has the focus.

**The canvas** holds the app's window the way a Figma canvas holds a frame. It opens at 100%, centred between the panels, and stays centred until you move it.
- **Zoom:** <kbd>⌘</kbd><kbd>+</kbd>, <kbd>⌘</kbd><kbd>−</kbd>, <kbd>⌘</kbd><kbd>0</kbd> (100%), <kbd>⇧</kbd><kbd>1</kbd> (fit between the panels), a pinch or <kbd>⌘</kbd>-scroll, or the zoom pill.
- **Pan:** scroll over the canvas, drag around the app, or hold <kbd>Space</kbd> and drag anywhere.

**Trying and picking:**
- **Click a version to try it.** It runs at once on the same screen, and the app keeps its state.
- **While you try one,** **Back to …** and **Use this version** sit at the foot of Explorations.
- **Use this version** makes it the pick, saved to `<data>/picks.json`.
- **Links:** `?playground=<screen>/<exploration>&v=v1` opens trying that version, and `#/<screen>` opens on a screen.

**The header** has the screen picker, the window size (the sizes in `playground.json`; `"zoom": "fit"` there opens the window fitted between the panels instead of at 100%), **Reset**, which starts the app again, and, at the top right, **Commit** (see "Commit to main"). **The bar** under it has **Reload app**, the app's status, any errors from the last reload, and **Open the app alone ↗**.

**The look and motion** are the kit's, after React Bits' Stepper: frosted cards, raised tiles, recessed wells, and spring motion. New parts use the variables in `src/style.css` (`--frame`, `--tile`, `--well`, `--spring`). With reduced motion set, everything just appears.

## Star and delete

Each version is a tile: its name, its number and date, and three actions on the right, **Show more** (the chevron), the star and the bin. An exploration's title has the same three. What a version says about itself (what it was copied from, and its note) and what an exploration tries stay folded away until **Show more** opens them. The actions are quiet until the pointer is on the tile, and a star that's on stays lit. When an exploration has many branches, the graph's lanes close up so the names keep their room.

- **Star** what's worth keeping. Starred explorations come first in their folder, and everything starred is listed under **Starred** at the top of the screens list: a starred exploration opens its folder, and a starred version is tried at once. A star is kept in the exploration's `versions.json` (`"starred": true`), so it stays when the playground reloads.
- **Starred only,** the star beside the crosshair, hides everything without a star. An exploration with starred versions shows just those, with the versions they were copied from, main, the pick and any trial, so the graph still joins up. **Show all** turns it off. It's kept in this browser.
- **Delete** what you won't use. It asks first (<kbd>⇧</kbd>-click doesn't), then moves the folder to `playground/trash/`. A deleted version's copies stay, joined to the version it came from. If it was the pick, its exploration goes back to main. The app reloads without it, and **Undo** in the toast puts it back. The trash is kept for 14 days, and git ignores it. main can't be deleted: it's the app.

Deletes wait while a commit is running.

## Ask Claude for a version

Chat is on whenever `serve.py` finds Claude Code: on the PATH, in its usual install folders, or inside the VS Code, Cursor or Windsurf extension. `--model sonnet` picks the model, and `--no-chat` turns chat off. When chat can't run, the Claude panel shows the one step that fixes it.

Describe a version in the Claude panel and press Enter.

- **Claude Code runs on this computer** (`claude -p`, headless), with your own login, in the project.
- **Claude starts a version** with `duplicate.py`, from the version on show, or with `new.py` for a new exploration. It changes the copy, then runs `reload.py`, which reloads the app and prints any errors, so Claude fixes them before it finishes. The playground tries the new version as soon as it exists.
- **Claude knows what's on show:** the screen and its parameters, the file it's drawn from, the open folder, and the exploration and version.
- **Screenshots.** Hold <kbd>⌥</kbd> and drag over any part of the page, or press the capture button and drag. The app draws its part at twice its size, and the capture comes with a note naming the parts of the app inside it. You can also drag, paste or pick images of your own. They're saved to `playground/attachments/`, which git ignores.
- **Notes**, after [Agentation](https://www.agentation.com/):
  - Press <kbd>N</kbd>, then click a part of the app or drag over an area, and write a note. Mark it **Fix**, **Change** or **Question**.
  - Notes wait, pinned, until **Send** takes them all in one message.
  - Claude answers each note with **Done**, **Question** or **Skipped**, and the answer shows on its pin.
  - Notes stay on this computer (`playground/notes/`, which git ignores).
- **Paste and dictate straight in.** A paste or ⌘V goes into the chat box even while the app has the focus.
- **Follow-ups change the same version.**
- **Run up to four chats at once,** with **+** at the top of the panel. Each chat is its own conversation and makes its own versions. Every chat shares the one app, so an error in one chat's version shows in every reload until it's fixed.
- **Claude is locked down.** It can read the project, write only under `<data>/`, and run only `new.py`, `duplicate.py` and `reload.py`. Anything else is refused without asking, and your own Claude Code settings and MCP servers aren't loaded. Only the playground's own page can start a run.
- **"Use it" or "make it the real thing"** gets you pointed at **Use this version**: the chat can't pick for you.

## Add a version

```sh
python3 playground/duplicate.py <screen>/<exploration> v1 "Name"      # or default; --id v2b for a variant
```

This copies `v1` to the next free number and adds it to `versions.json` with today's date. Change the copy, write what it changes in its `note`, then press **Reload app** (or run `python3 playground/reload.py`). Copying `default` copies the app's own file for the screen (its `file` in `screens.json`) and writes the version file from `templates/`.

## Start an exploration

```sh
python3 playground/new.py <screen> <exploration> "Title" "What it tries, in one sentence."
python3 playground/duplicate.py <screen>/<exploration> default "First idea"
```

The screen must be one listed in `<data>/screens.json`. The exploration's name is lowercase letters, numbers and hyphens.

## How it works

```
playground/                  the page and its tools (the kit, plus this project's files)
  playground.json            this project: name, ports, data folder, how the app starts
  RULES.md                   this project's rules for Claude in the chat
  templates/                 how duplicate.py turns a copied screen into a version
  serve.py                   the server: files, the app, picks, stars and deletes, chat, commit
  trash/                     deleted explorations and versions, for 14 days (git ignores it)
  index.html, src/           the page: host.js (the layers, the canvas, the app's frame),
                             playground.js (the panels), style.css
  new.py, duplicate.py       start an exploration, start a version
  reload.py                  reload the app and print its errors
  pglib.py                   what those share; writes the registry
<data>/                      the explorations, inside the app's source so it compiles them
  screens.json               the app's screens by id, with the file each is drawn from
  index.json                 every exploration, as <screen>/<exploration>
  picks.json                 which version of each runs ("default" is the app as it is)
  registry.*                 generated: every version, by id
  <screen>/<exploration>/    one exploration
    versions.json            its title, start screen and versions, oldest first, and their stars
    v1/                      what v1 changes, and the files it copied
```

- **The page is the player.** `host.js` keeps the explorations, the picks and the version being tried. It tells the app over `postMessage` which versions to lay over its screens, and the app's bridge answers.
- **Every version is compiled in,** through the registry, so switching is instant and keeps the app's state.
- **A version maps each screen it changes to a builder,** which gets `below` (the screen under it: the app's own, or another running version's) and `app` (the app's own screen). It can draw its own copy or wrap `below`. When two picked versions change the same screen, the later one in `index.json` is laid over the earlier one, and the playground says so in a toast.

## Commit to main

**Commit**, at the top right of the header, makes the picks part of the app, for good. It turns blue with the number of picks once a version is picked. It opens a dialog that lists the picks, the branch the project is on, and any other changes nobody has committed, with a box for a note. Then **Commit**:

1. **Claude Code moves each picked version into the app's own files,** as in "Move a picked version into the app" below, following the project's conventions. It can write anywhere in the project apart from `playground/`, the explorations and `.git`. It runs only `reload.py`, plus whatever `"commit": {"allow": [...]}` in `playground.json` adds, in Claude Code's permission form. A project whose screens are written by scripts lists them, such as `"Bash(node tools/:*)"`.
2. **The app is reloaded and checked.** If it has errors, nothing is committed and the moved files are left as they are, to fix.
3. **Each pick goes back to main,** which now shows it, and its version is marked `"merged"` with the date in `versions.json`. The folder stays as the record.
4. **The files the move changed are committed** on this computer, in one commit, on the branch the project is on. It's made as your git user, and the message names each pick and its note. With **Also commit the other changes** ticked, everything else git sees changed goes in too. Nothing is pushed: `git push` shares it.

Explorations, `index.json` and `picks.json` are never committed. Commit waits while a chat is working, and only the playground's own page can start it.

## Move a picked version into the app

**Commit** does this for you. To do it by hand, outside the chat, ask Claude Code to "move the picked <screen> › <exploration> version into the app". It copies the version's changes over the app's own files, following the project's conventions, sets the pick back to `default`, and keeps the version folder as the record.
