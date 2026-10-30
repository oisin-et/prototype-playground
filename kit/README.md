# Playground

The playground is where the app's screens are explored in versions, inside the running app. It comes from the prototype-playground kit, which is the same in every project. What's particular to this project is in `playground.json` (name, ports, where the explorations live, how the app starts) and `RULES.md` (its rules for Claude). Don't change the kit's files here: change the kit and run the skill's `setup.py --update`.

## Run it

From the top of the project:

```sh
python3 playground/serve.py --open
```

Or double-click **Open playground.command** in this folder. It opens `http://localhost:<port>` (the `port` in `playground.json`). `serve.py` starts the app on its own port and keeps it running: a Flutter app with `flutter run -d web-server`, a web app with its dev server (`app.command`). The page shows the app once it's ready. Stop it with <kbd>Ctrl</kbd>+<kbd>C</kbd>, which stops the app too.

The app sits on a **canvas**, and two panels float over it, one on each side:

- **Explorations, on the left,** is the file manager. Every screen of the app is a folder, and the screen on show is pinned at the top. **Show this screen** takes the app there. The crosshair does the reverse: it opens the folder of the screen on show, with the running version's exploration open.
- **Explorations go wide, iterations go deep.** An exploration is one direction for the screen, numbered 1, 2, 3 … An iteration is a step further along one: exploration 4 starts at **4.0**, and its iterations are **4.1**, **4.2** … each copied from the one it builds on. Going back to exploration 2 and carrying on makes 2.1, and so on.
- **Each exploration is a folder.** A screen's folder lists **main** (the app as it is), then its explorations, each a folder of its own with its name, number and how many iterations it has, and whether the pick or a trial is in it. Pressing one opens it in place, with 4.0 at the top and each iteration under it, and pressing it again shuts it. Any number can be open; the panel stays 320 px wide. Until you open or shut one, the folder holding the version on show is open. **Ready for main**, at the top, says what a commit would bring in, and gathers every pick on the screens list.
- **Hover a version to see it.** A card beside the panel shows its picture and what it is: its number, name, date, what it came from and its note. The picture is taken whenever the version is on its own screen (after every reload too, so it follows the version as it changes) and kept in `playground/thumbs/`, which git ignores. A version that has never been on screen says so. `"preview"` in `playground.json` names the element to picture, as a CSS selector (`"#screen"`); without it, the whole app is.
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
- **Links:** `?playground=<screen>&v=v4.2` opens trying that version, and `#/<screen>` opens on a screen.

**The header** has the screen picker, the window size (the sizes in `playground.json`; `"zoom": "fit"` there opens the window fitted between the panels instead of at 100%), **Reset**, which starts the app again, and, at the top right, **Commit** (see "Commit to main"). **The bar** under it has **Reload app**, the app's status, any errors from the last reload, and **Open the app alone ↗**.

**The look and motion** are the kit's, after React Bits' Stepper: frosted cards, raised tiles, recessed wells, and spring motion. New parts use the variables in `src/style.css` (`--frame`, `--tile`, `--well`, `--spring`). With reduced motion set, everything just appears.

## Star and delete

Each version is a tile: its number and date, its name, and three actions over its top right corner, **Show more** (the chevron), the star and the bin. What a version says about itself (what it was copied from, and its note) stays folded away until **Show more** opens it. The actions are quiet until the pointer is on the tile, and a star that's on stays lit. An exploration's tile has a bin too, which deletes it with all its iterations.

- **Star** what's worth keeping. Everything starred is listed under **Starred** at the top of the screens list, and a starred version is tried at once from there. A star is kept in the screen's `versions.json` (`"starred": true`), so it stays when the playground reloads.
- **Starred only,** the star beside the crosshair, hides everything without a star: just the starred versions show, with the versions they were copied from, main, the pick and any trial. **Show all** turns it off. It's kept in this browser.
- **Delete** what you won't use. It asks first (<kbd>⇧</kbd>-click doesn't), then moves the folder to `playground/trash/`. A deleted version's copies stay, joined to the version it came from. If it was the pick, the screen goes back to main. The app reloads without it, and **Undo** in the toast puts it back. The trash is kept for 14 days, and git ignores it. main can't be deleted: it's the app.

Deletes wait while a commit is running.

## Ask Claude for a version

Chat is on whenever `serve.py` finds Claude Code: on the PATH, in its usual install folders, or inside the VS Code, Cursor or Windsurf extension. `--model sonnet` picks the model, and `--no-chat` turns chat off. When chat can't run, the Claude panel shows the one step that fixes it.

Describe a version in the Claude panel and press Enter.

- **Claude Code runs on this computer** (`claude -p`, headless), with your own login, in the project.
- **A change is an iteration, a new idea an exploration.** Feedback on what's on show ("make the meters thinner", a note pinned to it) makes the next iteration of the version on show with `iterate.py`: on show 4.2, it makes 4.3 (or the next free number in that column). A different idea, another way, or "a new exploration" starts the next exploration with `new.py`, from main, or from a version to take it in a new direction. "Go back to 2" carries on from exploration 2. When it's unclear, Claude makes an iteration.
- **Every step is kept.** Each follow-up makes a new iteration, so you can step back up the column. Claude changes a version in place only to fix it.
- **Claude starts each version from its copy.** It changes the copy, then runs `reload.py`, which checks the app and prints any errors, so Claude fixes them before it finishes.
- **Claude builds out of sight.** While it works, the app on screen is left as it is: it doesn't reload or switch, so you can keep using it. The version being made shows in Explorations as **Claude is building it…**, locked until the run is done. A Flutter app's hot reloads, and a dev server's own reloads, still happen while Claude works, but the screen stays on the version you chose.
- **Every request shows how it's going.** From the moment you press Send, a card over the chat box has a progress bar and the time it's taken, and says what Claude is doing: looking at the app, building the version, checking it runs. It turns amber while Claude fixes an error it hit, and red if the run stops on one. When it's done the card says the version is ready, with **View it**, and a toast says so too (a web app with `"hot": false` loads its frame again at that point, once). The card stays until you view the version, dismiss it, or send the next request. A chat that isn't on show keeps its card, with an amber badge, until you open it.
- **Each request leaves a line in the chat:** what it built, how long it took, the errors fixed on the way and what it cost, with **View** to put that version on again later.
- **Claude knows what's on show:** the screen and its parameters, the file it's drawn from, the open folder, and the version by its number. Say "exploration 4", "version 4" or "4.2" and it knows which.
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
- **"Use it" or "make it the real thing"** gets you pointed at **Use this version**: the chat can't pick for you.

## Start an exploration, or iterate on one

```sh
python3 playground/new.py <screen> "Name"                   # the next exploration, from main
python3 playground/new.py <screen> "Name" --from 4.2        # a new direction from a version
python3 playground/iterate.py <screen> 4.2 "Name"           # the next iteration of exploration 4, from 4.2
```

The screen must be one listed in `<data>/screens.json`; its first exploration starts its `versions.json`. A version is named by its number: `4.2`, `v4.2`, or `4` for 4.0. Each copies the version (or, from main, the app's own file for the screen, its `file` in `screens.json`, with a version file from `templates/`) and adds it to `versions.json` with today's date. Change the copy, write what it changes in its `note`, then press **Reload app** (or run `python3 playground/reload.py`).

A playground from before the numbering, with explorations by topic (`<screen>/<topic>/v1`), moves over once with `python3 playground/migrate.py` (it shows what it would do) and then `--apply`. Each version is renumbered by what it was copied from: one copied from main starts an exploration, and one copied from another is the next iteration of that one's.

## How it works

```
playground/                  the page and its tools (the kit, plus this project's files)
  playground.json            this project: name, ports, data folder, how the app starts
  RULES.md                   this project's rules for Claude in the chat
  templates/                 how a copied screen becomes a version
  serve.py                   the server: files, the app, picks, stars and deletes, chat, commit
  trash/                     deleted explorations and versions, for 14 days (git ignores it)
  thumbs/                    each version's picture, for the preview on hover (git ignores it)
  index.html, src/           the page: host.js (the layers, the canvas, the app's frame),
                             playground.js (the panels), style.css
  new.py, iterate.py         start an exploration, iterate on one
  migrate.py                 move topic folders to explorations and iterations, once
  reload.py                  reload the app and print its errors
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

**It runs in the background.** Once you press **Commit**, the dialog closes and you carry on designing: trying versions, picking, and chatting with Claude all work while it runs. The header's button says **Committing…** with a bar along its foot that fills as the move, the check and the commit go by. Press it to see the steps, and close them again at any time. When it's done the button says **Committed** (or **Commit failed**) until you press it to see how it went, and a toast offers **Reload** to bring in main as it is now. Deletes wait until it's done, and leaving the page asks first (the commit carries on without it, but the page loses sight of it).

Explorations, `index.json` and `picks.json` are never committed. A commit can't start while a chat is working, and only the playground's own page can start it.

## Move a picked version into the app

**Commit** does this for you. To do it by hand, outside the chat, ask Claude Code to "move the picked <screen> version into the app". It copies the version's changes over the app's own files, following the project's conventions, sets the pick back to `default`, and keeps the version folder as the record.
