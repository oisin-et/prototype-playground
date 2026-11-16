"""Serve the project's playground: the app between two panels, versions of
its screens tried live, and a chat that asks Claude for new ones.

    python3 playground/serve.py [port] [--open] [--no-chat] [--model MODEL] [--app-port N]

then open http://localhost:<port> (the "port" in playground/playground.json,
8820 unless it says otherwise). --open opens it in the browser (or, if it's
already running on that port, just opens it). "Open playground.command" does
that on a double-click.

Part of the prototype-playground kit: the same in every project. Everything
about this project is in playground/playground.json (and its rules for
Claude in playground/RULES.md); don't change this file for one project.

It's `python3 -m http.server` over the project with these additions:

- The app. It runs the app on --app-port ("app.port" in playground.json) and
  keeps it, so the playground page can show it in a frame and reload it when
  a version changes (POST /playground/app/reload, which playground/reload.py
  calls too). A Flutter project runs `flutter run -d web-server` and
  hot-reloads; a web project runs its own dev server ("app.command"), which
  reloads changed files itself. A server that doesn't (static files, with
  "app": {"hot": false}) has the app's frame loaded again instead. Before
  every reload the registry, the list of versions the app compiles in, is
  written again.

- Picks. The Explorations strip's "Use this version" posts the picks here,
  and they're written to <data>/picks.json, one per screen. Only picks that
  name a screen in <data>/index.json and one of its versions are kept.

- Chat (on unless --no-chat, when Claude Code is on this computer). The Claude
  panel posts a prompt here, and this runs Claude Code headless (`claude -p`)
  in the project, using your own Claude login, and streams what it does back to
  the panel as lines of JSON. Claude is locked down: it can read the project
  (and the folders "read" in playground.json names, only to read them),
  write only under <data>/, and run only playground/new.py, iterate.py and
  reload.py. Anything else is refused without asking
  (--permission-mode dontAsk), and your own Claude settings and MCP servers
  aren't loaded. Only the playground's own page can call it: the request must
  come from this server's origin with the panel's header. Each of the panel's
  chat tabs can have one run going, up to MAX_RUNS at once, and each is stopped
  on its own. PLAYGROUND_CLAUDE names another `claude` to run (for testing).

- Commit (the header's button, GET and POST /playground/commit). It shows the
  picks and the branch, then has Claude Code move each picked version into the
  app's own files (it can write anywhere but playground/, the explorations and
  .git), reloads and checks the app, sets each pick back to "default", and
  commits the files the move changed on this computer. Nothing is pushed. See
  the Commit class.

- Pictures (GET and POST /playground/thumbs): the page sends a picture of each
  version once it has been on screen, kept in playground/thumbs/<screen>/
  <version>.png (git ignores it), for the preview on hover in Explorations.

- Files (GET /playground/files/…), for the Files panel: the project's
  folder as it is on disk, git's marks on it, a file's contents for the
  reader, and every file's path to find one by name. Read only, and only
  inside the project.

- The library (GET /playground/library), for the Library panel: each
  component's entry and every use, found by library.py's scan of the app's
  files ("library" in playground.json). Read only.

- Stars and deletes (POST /playground/explorations), from the star and bin
  buttons in Explorations. A star is kept in the screen's versions.json.
  A delete moves a version's folder to playground/trash/
  (git ignores it; cleared after 14 days), and the toast's Undo puts it back.

Screenshots sent with a prompt are saved to playground/attachments/ (git
ignores it; files older than 14 days are cleared when the server starts), and
Claude is told to read them. Only PNG, JPEG, WebP and GIF, up to 6 a message
and 8 MB each.

Notes pinned to parts of the app go with a prompt too, as many as are waiting.
Each batch is saved to playground/notes/<time>/ (notes.json and a picture of
each note; git ignores it, and batches older than 14 days are cleared when the
server starts). Claude may edit that notes.json, and nothing else outside
<data>/: it sets each note's status and reply there as it works, and when the
run ends they're sent back to the panel, which shows them on the pins.

Files are served without caching. Standard library only; it listens on this
computer only. Claude Code is found on the PATH, in its usual install
folders, or inside the VS Code, Cursor or Windsurf extension.
"""

import argparse
import base64
import binascii
import collections
import contextlib
import errno
import hashlib
import json
import os
import re
import shlex
import secrets
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import frozen
import system
from pglib import ADAPTER, BOARDS, CANVAS, CONFIG, DATA, HERE, INDEX, PICKS, REGISTRY, ROOT, VERSION_FILE, add_boards, add_to_canvas, board_explorations, known_versions, playground_lock, rel, write_json, write_registry

ATTACHMENTS = HERE / "attachments"
NOTES = HERE / "notes"
TRASH = HERE / "trash"  # what was deleted from Explorations, for 14 days
CHATS = HERE / "chats"  # the canvas's chats (composer.js): one JSON file a chat, kept until deleted
CHAT_ID = re.compile(r"^c[a-z0-9]{1,30}$")
MAX_CHAT_BYTES = 4 * 1024 * 1024
THUMBS = HERE / "thumbs"  # a picture of each version, for the preview in Explorations
IMAGES = {  # type → (extension, how the file starts)
    "image/png": ("png", (b"\x89PNG\r\n\x1a\n",)),
    "image/jpeg": ("jpg", (b"\xff\xd8\xff",)),
    "image/gif": ("gif", (b"GIF87a", b"GIF89a")),
    "image/webp": ("webp", (b"RIFF",)),
}
MAX_SHOTS, MAX_SHOT_BYTES = 6, 8 * 1024 * 1024
MAX_NOTES = 40
MAX_RUNS = 4  # chats working at once: one per tab of the Claude panel
NOTE_INTENTS = {"fix", "change", "question"}
NOTE_STATUSES = {"done", "question", "skipped"}

NAME = CONFIG.get("name", ROOT.name)
DATA_REL = rel(DATA)

# How a version is written, by kind of project.
VERSION_RULES = {
    "flutter": f"""- A version is Dart. {VERSION_FILE}'s `version` getter maps each screen it changes to a
  builder (context, below, app): `below` is the screen under this version (the app's own,
  or another running version's), `app` the app's own screen widget. A copy of the screen
  is built from app's arguments; a small change can wrap `below`. To change a widget the
  screen uses, copy that widget's file into the version folder too (make its relative
  imports package: ones) and import the copy from the version's screen.
  Keep `version` a getter.""",
    "web": f"""- A version is code the app imports. Its {VERSION_FILE} default-exports
  {{ pages: {{ <screen>: (ctx) => ... }} }}: ctx.below is the screen under this version (the
  app's own, or another running version's), ctx.app the app's own screen (ctx.app.props
  holds what it was given). playground/RULES.md says what a builder returns in this
  project. A small change can wrap ctx.below. To change a component the screen uses, copy
  its file into the version folder too (point its relative imports back at the files they
  named) and import the copy from the version's screen.""",
}


# Design guides: skills whose craft rules the chat follows whenever it designs a
# version, after the project's own rules. "guides" in playground.json lists them,
# [{"path", "about", "read": [files in it, read first]}]; "guides": [] turns them off.
# Left out, the playground uses the Stageshow skill (Benji Taylor's) if it's installed:
# in the project's .claude/skills, ~/.claude/skills or ~/.agents/skills.
STAGESHOW = {
    "name": "Stageshow",
    "about": "a guide to product UI that reads as a real, finished product. Follow its craft "
             "rules, not its kit: the one idea and how hard to press (SKILL.md), restraint, type, "
             "spacing, icons, colour and density (references/craft.md), and the reviewer's eye "
             "(references/review.md). Its React kit, stage, framing and crops for marketing "
             "pages, cursors and filming are for product shots, not for this app: leave them.",
    "read": ["SKILL.md", "references/craft.md", "references/review.md"],
}


def guides():
    """The design guides the chat follows: [(folder, about, [files])], each folder real."""
    listed = CONFIG.get("guides")
    if listed is None:
        for place in (ROOT / ".claude/skills/stageshow", Path.home() / ".claude/skills/stageshow", Path.home() / ".agents/skills/stageshow"):
            if (place / "SKILL.md").is_file():
                listed = [{**STAGESHOW, "path": str(place)}]
                break
        else:
            return []
    found = []
    for item in listed:
        item = {"path": item} if isinstance(item, str) else item
        path = (ROOT / os.path.expanduser(str(item.get("path", "")))).resolve()
        if path.is_dir() and item.get("path"):
            found.append((path, str(item.get("about", "")).strip(), [str(f) for f in item.get("read", [])], str(item.get("name", path.name))))
        else:
            print(f"playground.json \"guides\": {item.get('path')!r} isn't a folder, so Claude can't follow it.", file=sys.stderr)
    return found


def guide_rules():
    """The guides, for the chat's rules: what to read before designing, and how to use it."""
    found = guides()
    if not found:
        return ""
    out = "\nDesign guides. Before you design a version, read these (once a conversation is enough),\n" \
          "and follow them wherever this project's rules and its CLAUDE.md are silent; where they\n" \
          "disagree, the project wins. Build with the project's own components and tokens, never a\n" \
          "guide's. Before you reload, look at your version as the guide's reviewer would, and fix\n" \
          "what they'd send back. In the version's note, name the rule behind a choice where it helps.\n"
    for path, about, read, name in found:
        out += f"- {name}, in {path}" + (f": {about}" if about else "") + "\n"
        out += "".join(f"  Read {path / f}\n" for f in read)
    return out


def references():
    """The folders outside the project that Claude may read: "read" in playground.json,
    [{"path": <from the project's top, or absolute>, "about": <what's there>}], and the
    design guides (see guides()). Those that aren't there are left out, with a warning."""
    found = []
    for item in CONFIG.get("read", []):
        item = {"path": item} if isinstance(item, str) else item
        path = (ROOT / str(item.get("path", ""))).resolve()
        if path.is_dir() and item.get("path"):
            found.append((path, str(item.get("about", "")).strip()))
        else:
            print(f"playground.json \"read\": {item.get('path')!r} isn't a folder, so Claude can't read it.", file=sys.stderr)
    return found + [(path, "") for path, *_ in guides() if path not in [p for p, _ in found]]


def reference_flags():
    """Claude Code's flags that let it read the references (and nothing more there). They
    start with Read rules, so they go straight after the --allowedTools list."""
    paths = [str(path) for path, _ in references()]
    return [f"Read(/{p}/**)" for p in paths] + (["--add-dir", *paths] if paths else [])


def reference_rules():
    """The references, for the rules: where each is and what it's for."""
    mine = {p for p, *_ in guides()}
    refs = [(p, a) for p, a in references() if p not in mine]
    if not refs:
        return ""
    return "\nOther folders you can read (only read: never change them, and don't run anything there):\n" + \
        "".join(f"- {path}" + (f": {about}" if about else "") + "\n" for path, about in refs)


def library_rules():
    """Designing with the library, for the rules, when the project has one."""
    if not CONFIG.get("library"):
        return ""
    lib = CONFIG["library"].get("dir", "library")
    return f"""
Designing with the library (the project's components: {lib}/, and playground/README.md's
"The component library"):
- Before you build, run python3 playground/library.py --brief: the components the app is
  built from, what each is for and what draws it. Look in this order:
  1. The project's own library. Use a component as it is: place its renderer, or a
     shared part with "use". Never draw another that does the same job, never copy a
     shared part's tree (place it), and never draw a look-alike of one: draw it with
     the component it looks like. Read an entry in {lib}/ for its rules and states.
  2. The folders you may read (below), for a component to adapt to this project.
  3. References (products, pictures, the guides) for ideas only.
  Colours, sizes and type come from the project's tokens, never written out.
- When nothing in the library fits, propose a new component: write its entry, in the
  format of the entries in {lib}/ (read one), with "status": "proposed", what it's for,
  what it's not for and its rules, and "lineage" (what it's adapted from or inspired
  by), to <the version's folder>/library/<id>.json, and draw it under the one name its
  "implementations" give. One proposal per new component, never one per screen.
- After python3 playground/reload.py, run python3 playground/library.py --check
  <screen> <version> and fix what it says is out of step before you finish. If you
  leave one, say why in your answer. The person sees the check on the version too.
"""


CANVAS_RULES = f"""
This message comes from the canvas (canvas.html), not the Explorations strip. On the
canvas these rules come first, and replace the rules above where they differ:

- Every frame on the canvas is one exploration of a screen, and its iterations stay
  inside it. Main is a frame too: the app as it is, with no versions.
- A version never changes after the message that made it, so every iteration the
  person has seen stays as it was. Every change the person asks for, however small,
  and a fix of something you got wrong in an earlier message, is a new iteration of
  the version the frame shows:
  python3 playground/iterate.py <screen> <version on show> "<short name>"
  Never update a version in place, and never change a version you didn't make in this
  message. (Within this message, keep fixing the version you made until it reloads with
  no errors.)
- On Main, a change starts a new exploration of the screen the frame shows:
  python3 playground/new.py <screen> "<short name>". It is main with only that change:
  copy as little as you can, and wrap what main draws (`below`, ctx.app) rather than
  draw it again, so everything else stays exactly main.
- A different direction ("another way", "a new exploration") is a new exploration too:
  new.py, with --from <version on show> when it takes that version somewhere new.
- Work on the page the frame shows, as the prompt names it (the page and its
  params). If the app has more than one place that draws what the person means (two
  copies of a part, an older screen that can still be reached), don't guess: change the
  one the frame shows, and say that the other exists.
- Each frame runs on main as it was when its exploration started (its frozen base), so
  it looks the same tomorrow. The prompt says if main has changed since. Main's files on
  disk are main as it is now: if the change needs something main has only had since the
  base, say so rather than rely on it.
- To keep a version for main, the person picks it (◆ in the frame's toolbar) and
  presses Commit. Don't edit {DATA_REL}/picks.json.
- Finish by naming the version you made, by its number: "4.4, an iteration of
  exploration 4" or "exploration 6, new, from main".
"""


# The canvas chat's starting prompts (composer.js's STARTERS): what each makes,
# and the board Claude writes so the canvas lays the answer out as a group.
# serve.py names the board's file; add_boards puts it on the canvas.
BOARD_FORMAT = """
The board is JSON, in the file named below (write it with the Write tool, once the
versions it names reload with no errors):
  {{"kind": "{kind}", "title": "<what the board shows, a few words>",
   "items": [{{"version": "main" or "<screen>/v<N>.<M>", "screen": "<screen id>",
              "params": {{...}} (only if the screen needs them to show this),
              "title": "<this item, a few words>", "note": "<one sentence>"}}, ...]{extra}}}
- "version" is what the item runs: "main", or one version this run made or the frame
  shows. "screen" is the id in screens.json the item opens on.
- Every version an item names must reload with no errors.
"""

STARTER_RULES = {
    "variants": """
The person pressed "Create 3 variants". Make three new explorations of the page the frame
shows, each a different layout and hierarchy (what comes first, what is big, how the page
is divided), not three colour or spacing tweaks of one layout. Each is a whole working
page: same content and functions, every control still works.
- python3 playground/new.py <screen> "<short name>" for each, with --from <version on
  show> when the frame shows an exploration (from main when it's Main).
- Name each by its idea ("Quiet: form in the hero"), and say in its note what it puts first.
- The board has the three, in the order you made them: one item each, on its v<N>.0.
""",
    "flow": """
The person pressed "Map out the entire flow". Map the journey that starts on the page the
frame shows: every step a person takes, in order, to the end of the task (and back, where
the task ends where it began). Under each step, its edge cases: what goes wrong or
differs there (a validation error, nothing to show, slow or no network, cancel or back,
already done, no permission), only the ones that step really has.
- Read the app's code first, to find the steps and the states each step has.
- A step or an edge case the app can show already (a screen, with its params) is an item
  on the version the frame shows ("main" on Main): make nothing for it.
- For the ones it can't show (a state that needs data, a click, an error), make ONE new
  exploration for the board: python3 playground/new.py <screen> "Flow: <short name>"
  --from <version on show> (no --from on Main), and leave its v<N>.0 as it is. Then one
  iteration of v<N>.0 for each state: python3 playground/iterate.py <screen> v<N>.0
  "<state>". Each forces its one state on the screen (wrap `below`, change only that),
  so v<N>.1, v<N>.2 … each show one state. A step the app doesn't have at all is drawn
  the same way, as the step it would be.
- The board's "items" are the steps, in order. Each step has "cases": a list of items
  in the same form, its edge cases, top to bottom. Add "arrows": one short label per
  arrow, for what moves the person from step i to step i+1 ("Submit", "Tap Verify").
""",
    "states": """
The person pressed "Show me all the states". Show every state the page the frame shows
can be in, side by side: the ones its code has (with data, empty, loading, error, signed
out, each plan or role, long and short content) and the ones a click opens (a menu, a
dialog, an open section, a selected row, a hover card). Only states this page really has.
- Read the page's code first, and list the states from it.
- The first item is the page as it is: the version the frame shows ("main" on Main).
- A state the app can show already (a screen and its params) is an item on that version.
- For the others, make ONE new exploration for the board: python3 playground/new.py
  <screen> "States: <page>" --from <version on show> (no --from on Main), and leave its
  v<N>.0 as it is. Then one iteration of v<N>.0 for each state: python3
  playground/iterate.py <screen> v<N>.0 "<state>". Each forces its one state on the
  page (wrap `below`, change only that). Never change the version on show to do it.
- The board's items are the states, in the order a person meets them.
""",
    "review": """
The person pressed "Review and fix". Review the page the frame shows for UX and
accessibility: hierarchy and what reads first, labels and copy, contrast (WCAG 2.2 AA:
4.5:1 for text, 3:1 for large text and controls), target sizes (24 px at least, 44 px
for touch), focus order and visible focus, names for controls and pictures, error and
empty states, and anything that blocks a keyboard or a screen reader.
- Read the page's code and its version first.
- Pick the top 3 to 5 issues, by how much each hurts a person. Fix those, and only those,
  in one new iteration of the version on show (python3 playground/iterate.py ...), or a
  new exploration on Main (python3 playground/new.py <screen> "Review fixes").
- The board has two items: the version on show, titled "Before", and the one you made,
  titled "After". Add "findings": one line per issue, "<the issue> → <the fix>", the
  fixed ones first, then at most 3 you saw and didn't fix, each starting "Not fixed:".
- In your answer, list the same findings.
""",
}
BOARD_EXTRA = {
    "flow": ',\n   (each step) "cases": [<items>], and "arrows": ["<step 1 → 2>", ...]',
    "review": ',\n   "findings": ["<the issue> → <the fix>", ...]',
}


def starter_rules(kind, board_rel):
    """What the prompt adds for a starting prompt: its rules and the board's format."""
    return STARTER_RULES[kind] + BOARD_FORMAT.format(kind=kind, extra=BOARD_EXTRA.get(kind, "")) + \
        f"Write the board to {board_rel}. Finish by saying what the board shows.\n"


def chat_rules(canvas=False):
    """What Claude is told on every run, after Claude Code's own instructions:
    the kit's rules, then the project's own (playground/RULES.md), read
    fresh so an edit to them counts at the next message. canvas: the message
    comes from the canvas, whose rules (CANVAS_RULES) come last and win."""
    try:
        own = (HERE / "RULES.md").read_text().strip()
    except OSError:
        own = ""
    rules = f"""You are working inside the playground of {NAME}, through a chat box in the
playground page, which runs the app between its panels. The person sees the app
reload as you work, so work in small, complete steps.

Rules:
- Read playground/README.md first. Follow it, this project's rules below, and the
  project's CLAUDE.md if it has one (its tokens and conventions, no hard-coded values
  where it has tokens).
- Work only in {DATA_REL}/ (and, to answer notes, the notes.json you're sent). You can't
  change anything else, and the only commands you can run are python3 playground/new.py,
  python3 playground/iterate.py, python3 playground/reload.py and python3
  playground/library.py (which only reads).
- Each screen's explorations are kept in {DATA_REL}/<screen>/, where <screen> is an id
  in {DATA_REL}/screens.json, with their list in its versions.json. Explorations go
  across and iterations go down, like columns on a board:
  - An exploration is one direction for the screen, numbered 1, 2, 3 … Its first
    version is v<N>.0 (folder {DATA_REL}/<screen>/v<N>.0/).
  - An iteration is a step further along one exploration: v<N>.1, v<N>.2 … down
    its column, each copied from the one it builds on ("from" in versions.json).
  - The person may say "exploration 4", "version 4", "route 4" or "4" for the
    column, and "4.2" or "v4.2" for one iteration. main ("default") is the app as it is.
- Before you touch a file, decide which of three things the message asks for. This
  decides how the board reads, so judge it every time, by what the change means for
  the design, not by how many files or lines it takes:

  1. An update, in place. A small change that doesn't alter the design's idea or how
     it reads: a few pixels of spacing or alignment, a typo or a word, the right
     token for a colour, a size brought in line with its neighbours, a bug, or
     anything that makes the version do what it already meant to do. Nobody would
     want to compare before and after, or go back to before. Change the version on
     show in place, with no new number, and add one short line about it to the end
     of its note. Only update a version that the person isn't keeping as it is: if
     it's starred, picked, merged, or another version was copied from it, make an
     iteration instead.
  2. An iteration: the next step down the column. A change someone could look at
     side by side with what was there and prefer either: something moved, resized
     or restyled enough to read differently, a control added, removed or changed in
     how it works, a new hierarchy or emphasis, a batch of notes that together
     change the look. It's still the same idea for the screen.
     python3 playground/iterate.py <screen> <version on show> "<short name>"
     That makes the next iteration of its column (on show 4.2, with 4.3 already
     made, it makes 4.4 from 4.2). If the version on show is main, there's nothing
     to iterate on or update: start an exploration instead.
  3. An exploration: a new column. A different answer to what the screen is for: a
     different layout or structure, a different focal point or way of working, a
     change that throws away the exploration's core idea, or anything asked for as
     "another way", "an alternative", "try something different" or "a new
     exploration".
     python3 playground/new.py <screen> "<short name>"
     which starts v<N>.0 from main. To take a version in a new direction ("try 2.3
     another way"), add --from <version>.

  Tests, in order: Would anyone want to go back to the version as it was? No: an
  update. Is it still the same idea for the screen? Yes: an iteration. No: an
  exploration. Several small changes in one message add up: if together they change
  how the screen reads, it's an iteration. When you're torn between an update and
  an iteration, make the iteration; between an iteration and an exploration, make
  the iteration. Never make a new exploration for a small change, and never
  iterate on a typo. If the person names one ("a new iteration", "just tweak it",
  "a new exploration"), do what they name.
- A component exploration changes one of the library's components wherever the app
  draws it, on every screen at once. Its folder is {DATA_REL}/component-<id>/ (its
  versions.json has "component"), and its explorations show beside each screen's own on
  every screen the component is on. When the message is about a component rather than a
  screen ("a thicker knob everywhere", "make the two knobs one"), work there:
  python3 playground/new.py --component <id> "<short name>"
  starts one (python3 playground/library.py lists the components, what draws each, and
  where it's used), and python3 playground/iterate.py component-<id> <version> "<name>"
  iterates. Its version file exports {{ components: {{ <renderer>: (ctx) => ... }},
  parts: {{ <part>: (ctx) => ... }} }} instead of pages: ctx.below is what draws it under
  this version and ctx.app the app's own, and a builder returns one of the same kind.
  The same three-way judgment applies.
- The person may say "exploration 4", "version 4", "route 4" or "4" for a column,
  and "4.2" or "v4.2" for one iteration. main ("default") is the app as it is.
  "Go back to 2" means work on exploration 2's latest version (2.0 if it has no
  iterations yet), and "carry on from 2.1" on 2.1, not on the one on show.
- A follow-up in this conversation works on the version you made or updated last
  (or the one on show, if the person has moved to another), by the same three-way
  judgment. Fixing your own mistake (a reload error, something that didn't work as
  asked) is always an update to the version you made.
- Start every new version from its copy: change only that version's folder. An update
  changes only the folder of the version it updates.
- After changing a version, run python3 playground/reload.py. It reloads the app
  and prints any errors: fix them before you finish. A reload error about a
  version you didn't touch is still yours to report, not to fix.
- Only update a version in place under rule 1 above, or when the person asks for exactly
  that. Never change a version you weren't asked about.
- A version's folder may hold design.json: changes made with the canvas's Design dials,
  each a selector, what the dials say (type size, padding …) and the style properties the
  playground's bridge sets on what the selector matches. Keep it as it is, and don't
  write one yourself; a change the person asks for goes in the version's own code.
- Write what the version changes in its "note" in versions.json, in one or two
  plain sentences: for an iteration, what changed since the version it's from.
  Leave "starred" as it is: the person stars versions, and deletes them, in the
  Explorations strip. Never delete one yourself. Keep the JSON style: short arrays and objects on one line.
- Other chats may be working in {DATA_REL}/ at the same time as you, in their own
  versions, so the next number may not be the one you expect: use the one the
  script prints. Change versions.json and index.json only with the Edit tool (never Write
  them whole), so you don't wipe out a version another chat has just added, and
  leave versions you didn't make alone. A reload error in a version another chat is
  making may show up in your reload too: report it, don't fix it.
- Finish with one or two sentences saying what you did and to which version, by its
  number, and which of the three it was: "updated 4.3 in place", "4.4, an iteration
  of exploration 4" or "exploration 6, new".
- The person may attach screenshots: captures of part of the app, with a note naming
  the screen and the parts of it the capture covers, or images of their own. Read
  each one with the Read tool before you answer. Don't change or delete files in
  playground/attachments/.
- The person may send notes: several at once, each pinned to a part or an area of a
  screen, with a picture of it. They're listed in the prompt (with where the part was
  built, when the app can say) and saved in a notes.json under playground/notes/. Read
  each note's picture. Work through them as one batch: notes on the same screen are
  judged together by the three-way rule above, on the version the notes were made on
  (or, as a follow-up, the version you made in this conversation). Small fixes are
  one update; changes that together read differently are one new iteration; notes
  made on main start an exploration. A "question" note asks something: answer it, and
  change nothing unless it asks you to. Reload and fix errors before you answer.
  As you finish each note, set its "status" and "reply" in that notes.json, changing
  nothing else in the file: "done" with one plain sentence saying what you changed and
  in which version (or the answer to a question); "question" with what you need to know
  before you can do it (and do nothing for it yet); or "skipped" with why. The person
  sees the reply on the note's pin. Don't delete the file or its pictures.
- If the person asks to use, keep or pick a version, or to "make it the real thing",
  don't edit {DATA_REL}/picks.json and don't make a new version. Tell them to press
  "Use this version" at the right of the Explorations strip across the top, which makes it
  what the playground runs. If it's already picked, say so. Moving a version into the
  app for good is done in Claude Code outside this chat (the prototype-playground
  skill), so say that too.
- Two screens' picked versions can change the same screen (a version can add or
  change other screens too): the later one in index.json gets the earlier one's
  screen as `below`, and a whole copy hides it. So
  change only what the idea needs, and wrap `below` where you can rather than copying
  the whole screen.
""" + library_rules() + reference_rules() + guide_rules()
    if own:
        rules += "\nThis project's own rules (playground/RULES.md):\n\n" + own + "\n"
    if canvas:
        rules += CANVAS_RULES
    return rules


def shown_page(body):
    """'the "x" page (Title, a 1, b 2), drawn from f' from a message's body, or ''."""
    if not body.get("screen"):
        return ""
    shown = f"the \"{body['screen']}\" page"
    bits = [str(body["screenTitle"])] if body.get("screenTitle") else []
    if isinstance(body.get("params"), dict):
        bits += [f"{k} {v}" for k, v in body["params"].items()]
    if bits:
        shown += f" ({', '.join(bits)})"
    if isinstance(body.get("files"), list) and body["files"]:
        shown += ", drawn from " + " with ".join(str(f) for f in body["files"][:4])
    return shown


def canvas_context(body):
    """What the canvas's message says about its selected frame: which frame,
    the page it shows, and the main it runs on."""
    page = shown_page(body)
    if body.get("frame") != "exp" or not body.get("playground"):
        out = "The selected frame is Main: the app as it is, with no versions."
        if page:
            out += f" It shows {page}."
        return [out]
    pg, v = str(body["playground"]), str(body.get("version") or "")
    m = re.match(r"v(\d+)\.(\d+)$", v)
    if not m:
        return [f"The selected frame is {pg} {v}." + (f" It shows {page}." if page else "")]
    name = f" (\"{body['name']}\")" if body.get("name") else ""
    out = [f"The selected frame is exploration {m[1]} of {pg}, showing iteration {v}{name}: its folder is {DATA_REL}/{pg}/{v}/."]
    if page:
        out.append(f"It shows {page}.")
    if body.get("onMain"):
        out.append("The person has it laid over today's main, not its frozen base.")
    else:
        drift = frozen.base_drift(f"{pg}/{v}")
        if drift and drift["count"]:
            more = f" and {drift['count'] - len(drift['files'])} more" if drift["count"] > len(drift["files"]) else ""
            out.append(f"It runs on main as it was on {drift['base']} (commit {drift['commit']}), its frozen base. "
                       f"Main has changed since in {', '.join(drift['files'])}{more}: the frame doesn't have those changes.")
        elif drift:
            out.append(f"It runs on main as it was on {drift['base']} (its frozen base); main hasn't changed since.")
    return [" ".join(out)]


def find_claude():
    """The `claude` to run: PLAYGROUND_CLAUDE, the PATH, the usual install folders,
    then the newest VS Code / Cursor / Windsurf extension's own copy."""
    if os.environ.get("PLAYGROUND_CLAUDE"):
        named = os.environ["PLAYGROUND_CLAUDE"]
        return named if os.access(named, os.X_OK) else None
    home = Path.home()
    found = shutil.which("claude")
    if found:
        return found
    for p in (home / ".local/bin/claude", home / ".claude/local/claude", Path("/opt/homebrew/bin/claude"), Path("/usr/local/bin/claude")):
        if os.access(p, os.X_OK):
            return str(p)
    bundled = []
    for editor in (".vscode", ".vscode-insiders", ".cursor", ".windsurf"):
        bundled += (home / editor / "extensions").glob("anthropic.claude-code-*/resources/native-binary/claude")
    bundled = [p for p in bundled if os.access(p, os.X_OK)]
    return str(max(bundled, key=lambda p: p.stat().st_mtime)) if bundled else None


def find_flutter():
    if os.environ.get("PLAYGROUND_FLUTTER"):
        return os.environ["PLAYGROUND_FLUTTER"]
    found = shutil.which("flutter")
    if found:
        return found
    p = Path.home() / "development/flutter/bin/flutter"
    return str(p) if os.access(p, os.X_OK) else None


def save_attachments(items):
    """Saves the screenshots sent with a prompt, and returns [(path from the repo's top, note)]."""
    saved = []
    if not isinstance(items, list):
        return saved
    ATTACHMENTS.mkdir(exist_ok=True)
    stamp = unique_stamp()
    for n, item in enumerate(items[:MAX_SHOTS], 1):
        if not isinstance(item, dict) or item.get("type") not in IMAGES:
            continue
        ext, magic = IMAGES[item["type"]]
        try:
            data = base64.b64decode(str(item.get("data", "")), validate=True)
        except (binascii.Error, ValueError):
            continue
        if not data or len(data) > MAX_SHOT_BYTES or not data.startswith(magic):
            continue
        path = ATTACHMENTS / f"{stamp}-{n}.{ext}"
        path.write_bytes(data)
        saved.append((path.relative_to(ROOT).as_posix(), str(item.get("note") or "")[:3000]))
    return saved


def unique_stamp():
    """The time, and a few letters so two chats sending in the same second don't share files."""
    return time.strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(2)


def clear_old_attachments(days=14):
    if NOTES.is_dir():
        for d in NOTES.iterdir():
            if d.is_dir() and d.stat().st_mtime < time.time() - days * 86400:
                shutil.rmtree(d, ignore_errors=True)
    if not ATTACHMENTS.is_dir():
        return
    cutoff = time.time() - days * 86400
    for f in ATTACHMENTS.iterdir():
        if f.is_file() and f.stat().st_mtime < cutoff:
            f.unlink()


def image_data(url):
    """(extension, bytes) of a data: URL holding one of the image types, or None."""
    head, _, data = str(url or "").partition(",")
    kind = head.removeprefix("data:").removesuffix(";base64")
    if kind not in IMAGES or not head.endswith(";base64"):
        return None
    try:
        raw = base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError):
        return None
    ext, magic = IMAGES[kind]
    return (ext, raw) if raw and len(raw) <= MAX_SHOT_BYTES and raw.startswith(magic) else None


def save_notes(items):
    """Saves the notes sent with a prompt to playground/notes/<time>/notes.json, each
    with its picture beside it, and returns (that file from the repo's top, the notes),
    or (None, []) if there are none."""
    if not isinstance(items, list):
        return None, []
    text = lambda v, n=400: str(v or "")[:n]
    notes = []
    folder = NOTES / unique_stamp()
    for item in items[:MAX_NOTES]:
        if not isinstance(item, dict) or not text(item.get("comment")).strip():
            continue
        node = item.get("node") if isinstance(item.get("node"), dict) else {}
        area = item.get("area") if isinstance(item.get("area"), list) else []
        note = {
            "id": text(item.get("id"), 40),
            "n": item["n"] if isinstance(item.get("n"), int) and 0 < item["n"] < 1000 else len(notes) + 1,
            "intent": item.get("intent") if item.get("intent") in NOTE_INTENTS else "change",
            "comment": text(item.get("comment"), 2000),
            "screen": text(item.get("screen"), 80),
            "screenTitle": text(item.get("screenTitle"), 120),
            "params": {text(k, 40): text(v, 80) for k, v in (item.get("params") or {}).items()} if isinstance(item.get("params"), dict) else {},
            "files": [text(f, 200) for f in item.get("files", [])[:4]] if isinstance(item.get("files"), list) else [],
            "playground": text(item.get("playground"), 120) or None,
            "version": text(item.get("version"), 40) or None,
            "node": {k: text(node.get(k), 120) for k in ("id", "component", "text") if node.get(k)} or None,
            "area": [round(v) for v in area[:4] if isinstance(v, (int, float))] or None,
            "drag": item.get("drag") is True,
            "covers": text(item.get("covers"), 2000),
            "status": "open",
            "reply": "",
        }
        image = image_data(item.get("image"))
        if image:
            folder.mkdir(parents=True, exist_ok=True)
            path = folder / f"note-{note['n']}.{image[0]}"
            path.write_bytes(image[1])
            note["picture"] = path.relative_to(ROOT).as_posix()
        notes.append(note)
    if not notes:
        return None, []
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "notes.json").write_text(json.dumps({"notes": notes}, indent=2) + "\n")
    return (folder / "notes.json").relative_to(ROOT).as_posix(), notes


def describe_note(note):
    """One note, for the prompt."""
    where = note["screenTitle"] or note["screen"]
    if note["screen"] and note["screen"] != where:
        where += f" (screen \"{note['screen']}\")"
    if note["files"]:
        where += ", drawn from " + " combined with ".join(note["files"])
    if note["playground"]:
        where += f"; made on {note['playground']} {note['version'] or 'default'}"
    at = []
    if note["node"]:
        n = note["node"]
        at.append(f"the {n.get('component', 'widget')} widget built at {n.get('id')}" + (f" (\"{n['text']}\")" if n.get("text") else ""))
    if note["area"] and len(note["area"]) == 4:
        x, y, w, h = note["area"]
        at.append(f"the area at x {x}, y {y}, {w} × {h} of the app, in its logical pixels")
    if note.get("drag"):
        at.reverse()  # an area someone drew, inside a node
    lines = [f"{note['n']}. [{note['intent']}] {note['comment']}", f"   On {where}."]
    if at:
        lines.append("   Pinned to " + ", ".join(at) + ".")
    if note.get("covers"):
        lines.append(f"   {note['covers']}")
    if note.get("picture"):
        lines.append(f"   Picture: {note['picture']}")
    return "\n".join(lines)


def note_outcomes(path):
    """[{id, status, reply}] for the notes Claude has dealt with in a batch's notes.json."""
    try:
        notes = json.loads((ROOT / path).read_text())["notes"]
    except (OSError, ValueError, KeyError, TypeError):
        return []
    return [
        {"id": str(n.get("id")), "status": n["status"], "reply": str(n.get("reply") or "")[:2000]}
        for n in notes if isinstance(n, dict) and n.get("status") in NOTE_STATUSES
    ]


def in_notes(path):
    try:
        Path(path).resolve().relative_to(NOTES)
        return True
    except ValueError:
        return False


def playground_of(path):
    """(screen, version) for a file under <data>/<screen>/<version>/."""
    try:
        parts = Path(path).resolve().relative_to(DATA).parts
    except ValueError:
        return None, None
    if len(parts) < 2:
        return None, None
    return parts[0], (parts[1] if len(parts) > 2 else None)


def label(name, args):
    rel = lambda p: os.path.relpath(p, ROOT) if p else ""
    if name in ("Edit", "Write", "MultiEdit"):
        return f"{'Writing' if name == 'Write' else 'Editing'} {rel(args.get('file_path'))}"
    if name == "Read":
        return f"Reading {rel(args.get('file_path'))}"
    if name in ("Glob", "Grep"):
        return f"Searching for {args.get('pattern', '')}"
    if name == "Bash":
        return f"Running {args.get('command', '')}"
    return name


class FlutterApp:
    """A Flutter app, run by `flutter run -d web-server` and hot-reloaded on request.

    state: starting (compiling) → waiting (served, no page has opened it yet)
    → ready (a page is connected); reloading while a reload runs; stopped if
    flutter exits (the log says why)."""

    DONE = re.compile(r"Reloaded application|Restarted application|Reloaded \d+ of \d+ librar")
    FAILED = re.compile(r"Try again after fixing|Hot reload (was )?rejected|Hot restart failed|Failed to (hot )?re(load|start)|Recompile failed")
    ERROR = re.compile(r"(Error|error)( -|:)|\.dart:\d+:\d+")

    def __init__(self, port):
        self.port = port
        self.flutter = find_flutter()
        self.proc = None
        self.state = "off" if not self.flutter else "starting"
        self.log = collections.deque(maxlen=300)
        self.cv = threading.Condition()
        self.op = None  # the reload under way: {"lines": [], "result": None}
        self.lock = threading.Lock()  # one reload at a time
        self.last = None  # the last reload's result

    def start(self):
        if not self.flutter:
            self.log.append("Flutter wasn't found: install it, or set PLAYGROUND_FLUTTER to its flutter command.")
            return
        write_registry()
        env = dict(os.environ, PATH=f"{Path(self.flutter).parent}:{os.environ.get('PATH', '')}")
        self.proc = subprocess.Popen(
            [self.flutter, "run", "-d", "web-server", "--web-port", str(self.port), "--web-hostname", "127.0.0.1"],
            cwd=ROOT, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1, start_new_session=True,
        )
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        for raw in self.proc.stdout:
            line = raw.rstrip("\n")
            with self.cv:
                self.log.append(line)
                if "is being served at" in line and self.state == "starting":
                    self.state = "waiting"
                elif "Debug service listening" in line or "Connected to" in line:
                    if self.state in ("starting", "waiting"):
                        self.state = "ready"
                if self.op is not None:
                    self.op["lines"].append(line)
                    if self.DONE.search(line):
                        self.op["result"] = True
                    elif self.FAILED.search(line):
                        self.op["result"] = False
                self.cv.notify_all()
        with self.cv:
            self.state = "stopped"
            self.log.append(f"flutter run stopped (exit {self.proc.wait()}).")
            if self.op is not None and self.op["result"] is None:
                self.op["result"] = False
            self.cv.notify_all()

    def status(self):
        with self.cv:
            return {"state": self.state, "port": self.port, "host": "127.0.0.1", "log": list(self.log)[-40:], "last": self.last,
                "kind": "flutter", "starting": "flutter run is building the app for the browser. The first start takes about a minute."}

    def reload(self, restart=False, timeout=180):
        """Rewrites the registry and hot-reloads (or restarts). Returns
        {ok, message, errors}."""
        with self.lock:
            write_registry()
            with self.cv:
                if self.state in ("off", "stopped") or not self.proc:
                    return {"ok": False, "message": "The app isn't running: restart serve.py (its window says why it stopped).", "errors": list(self.log)[-12:]}
                if self.state != "ready":
                    return {"ok": False, "message": "The app is still starting: nothing to reload yet. It will start with the change in it.", "errors": []}
                self.op = {"lines": [], "result": None}
                was = self.state
                self.state = "reloading"
            try:
                self.proc.stdin.write("R" if restart else "r")
                self.proc.stdin.flush()
            except OSError:
                pass
            deadline = time.time() + timeout
            with self.cv:
                while self.op["result"] is None and time.time() < deadline:
                    self.cv.wait(1)
                ok, lines = self.op["result"], self.op["lines"]
                self.op = None
                if self.state == "reloading":
                    self.state = was
            errors = [l for l in lines if self.ERROR.search(l)][:40]
            kind = "restart" if restart else "reload"
            if ok:
                result = {"ok": True, "message": f"Hot {kind} done: the app runs the change.", "errors": []}
            elif ok is None:
                result = {"ok": False, "message": f"The hot {kind} didn't finish in {timeout} s.", "errors": lines[-12:]}
            else:
                result = {"ok": False, "message": f"The hot {kind} failed: the app didn't compile, so it still runs the code from before.",
                          "errors": errors or lines[-12:]}
            result["at"] = time.strftime("%H:%M:%S")
            self.last = result
            return result

    def stop(self):
        if self.proc and self.proc.poll() is None:
            try:
                self.proc.stdin.write("q")
                self.proc.stdin.flush()
                self.proc.wait(5)
            except (OSError, subprocess.TimeoutExpired):
                try:
                    os.killpg(self.proc.pid, signal.SIGTERM)
                except OSError:
                    pass


class CommandApp:
    """A web app, run by the project's own dev server: "app.command" in
    playground.json, with {port} and {host} filled in (a Vite app, say:
    "npm run dev -- --port {port} --host {host} --strictPort"). The dev server
    reloads changed files itself, keeping the app's state where it can. When
    the registry changes (a new or removed version), the playground page loads
    the app's frame again so it's read: the page compares the registry with
    the one the frame loaded, so it works whoever asked for the reload. A
    server that doesn't reload files itself ("hot": false, as for static
    files) has the frame loaded again after every reload instead.

    state: starting (until the app answers on its port) → ready; stopped if
    the command exits (the log says why); off with no command."""

    ERROR = re.compile(r"\berror\b|Failed to compile|SyntaxError|Cannot find module|Could not resolve", re.I)

    def __init__(self, port):
        app = CONFIG.get("app", {})
        self.port = port
        self.host = app.get("host", "127.0.0.1")
        self.path = app.get("path", "/")
        self.cmd = app.get("command")
        self.hot = app.get("hot", True)  # False: the server doesn't reload changed files itself
        self.proc = None
        self.state = "starting" if self.cmd else "off"
        self.log = collections.deque(maxlen=300)
        self.count = 0  # lines read so far, so a reload can see the lines after it
        self.cv = threading.Condition()
        self.lock = threading.Lock()
        self.last = None

    def start(self):
        if not self.cmd:
            self.log.append('playground/playground.json has no "app": {"command": ...} to start the app with.')
            return
        write_registry()
        self.proc = subprocess.Popen(
            self.cmd.format(port=self.port, host=self.host), shell=True, cwd=ROOT,
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1, start_new_session=True,
        )
        threading.Thread(target=self._read, daemon=True).start()
        threading.Thread(target=self._probe, daemon=True).start()

    def _read(self):
        for raw in self.proc.stdout:
            with self.cv:
                self.log.append(raw.rstrip("\n"))
                self.count += 1
                self.cv.notify_all()
        with self.cv:
            self.state = "stopped"
            self.log.append(f"The app's command stopped (exit {self.proc.wait()}).")
            self.cv.notify_all()

    def _probe(self):
        """Ready once the app answers on its port, whatever it answers."""
        url = f"http://{self.host}:{self.port}{self.path}"
        while self.state == "starting" and self.proc.poll() is None:
            try:
                urllib.request.urlopen(url, timeout=2).close()
            except urllib.error.HTTPError:
                pass
            except (OSError, ValueError):
                time.sleep(0.7)
                continue
            with self.cv:
                if self.state == "starting":
                    self.state = "ready"
            return

    def status(self):
        with self.cv:
            return {"state": self.state, "port": self.port, "host": self.host, "path": self.path, "log": list(self.log)[-40:],
                    "last": self.last, "kind": "web", "starting": "The app's dev server is starting."}

    def reload(self, restart=False, settle=1.5):
        """Rewrites the registry and reports what the dev server said about the
        change. Returns {ok, message, errors, frame}: frame "reload" (a
        restart) asks the page to load the app's frame again."""
        with self.lock:
            write_registry()
            with self.cv:
                if self.state in ("off", "stopped") or not self.proc:
                    return {"ok": False, "message": "The app isn't running: restart serve.py (its window says why it stopped).", "errors": list(self.log)[-12:]}
                if self.state != "ready":
                    return {"ok": False, "message": "The app is still starting: nothing to reload yet. It will start with the change in it.", "errors": []}
                mark = self.count
            time.sleep(settle if self.hot else 0)  # the dev server sees the files change on its own
            with self.cv:
                lines = list(self.log)[-(self.count - mark):] if self.count > mark else []
            errors = [l for l in lines if self.ERROR.search(l)][:40] if self.hot else self.check_files()
            if errors:
                result = {"ok": False, "errors": errors, "message": "The dev server reported errors: the app may still run the code from before."
                          if self.hot else "A version's files have errors, so it won't load:"}
            else:
                result = {"ok": True, "message": "Reloaded: the app runs the change." if not restart else "The app started again.", "errors": []}
            result["frame"] = "reload" if restart or not self.hot else None
            result["at"] = time.strftime("%H:%M:%S")
            self.last = result
            return result

    def check_files(self):
        """For a server that only serves files ("hot": false), nothing reports a
        broken version, so this checks the versions' files: JSON must parse,
        and JavaScript must pass `node --check` when Node is on this computer."""
        return check_paths(rel(f) for f in sorted(DATA.rglob("*")) if f.is_file() and f.name != REGISTRY.name)

    def stop(self):
        if self.proc and self.proc.poll() is None:
            try:
                os.killpg(self.proc.pid, signal.SIGTERM)
                self.proc.wait(5)
            except (OSError, subprocess.TimeoutExpired):
                pass


def check_paths(paths):
    """Errors in these files (paths from the project's top): JSON must parse, and
    JavaScript must pass `node --check` when Node is on this computer."""
    errors = []
    node = shutil.which("node")
    for p in paths:
        f = ROOT / p
        if not f.is_file():
            continue
        if f.suffix == ".json":
            try:
                json.loads(f.read_text())
            except ValueError as e:
                errors.append(f"{p}: {e}")
        elif f.suffix in (".js", ".mjs") and node:
            r = subprocess.run([node, "--check", str(f)], capture_output=True, text=True)
            if r.returncode:
                errors += [f"{p}:"] + [l for l in r.stderr.strip().splitlines() if l.strip() and not l.lstrip().startswith(("at ", "Node.js"))][:6]
    return errors[:40]


def make_app(port):
    return FlutterApp(port) if ADAPTER == "flutter" else CommandApp(port)


def made_by(text):
    """[(screen, version)] that a run of new.py or iterate.py says it made:
    "Made <screen> v<N>.<M> from …"."""
    # A screen's id is as screens.json names it (it may have capitals).
    return re.findall(r"Made ([\w-]+) (v\d+\.\d+) from ", text)


def result_text(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(str(c.get("text", "")) for c in content if isinstance(c, dict))
    return ""


class Chat:
    """Claude runs, one per chat tab and up to MAX_RUNS at once."""

    def __init__(self, model):
        self.model = model
        self.lock = threading.Lock()  # guards runs
        self.runs = {}  # tab → its Popen, or None while it starts
        self.claude = find_claude()

    def claim(self, tab):
        """Holds a place for the tab's run, or says why it can't have one."""
        with self.lock:
            if tab in self.runs:
                return "This chat is already working. Wait for it, or stop it."
            if len(self.runs) >= MAX_RUNS:
                return f"{MAX_RUNS} chats are working already. Wait for one, or stop one."
            self.runs[tab] = None
            return None

    def release(self, tab):
        with self.lock:
            self.runs.pop(tab, None)

    def ready(self):
        """Whether Claude Code can be run; looks again while it's missing."""
        if not self.claude:
            self.claude = find_claude()
        return self.claude is not None

    def command(self, prompt, session, canvas=False):
        cmd = [
            self.claude, "-p", prompt,
            "--output-format", "stream-json", "--verbose",
            "--setting-sources", "project",
            "--strict-mcp-config",
            "--permission-mode", "dontAsk",
            "--permission-prompts", "none",
            "--tools", "Read,Glob,Grep,Edit,Write,Bash",
            "--allowedTools", "Read(./**)", f"Edit({DATA_REL}/**)", f"Write({DATA_REL}/**)", "Edit(playground/notes/**)",
            "Bash(python3 playground/iterate.py:*)", "Bash(python3 playground/new.py:*)",
            "Bash(python3 playground/reload.py:*)", "Bash(python3 playground/library.py:*)",
            *reference_flags(),
            "--append-system-prompt", chat_rules(canvas),
        ]
        if self.model:
            cmd += ["--model", self.model]
        if session:
            cmd += ["--resume", session]
        return cmd

    def stop(self, tab=None):
        """Stops the tab's run, or every run if no tab is named."""
        with self.lock:
            procs = [p for t, p in self.runs.items() if tab is None or t == tab]
        for proc in procs:
            if proc and proc.poll() is None:
                proc.terminate()

    def run(self, tab, body, emit):
        """Runs Claude on the prompt in body, calling emit(event) as it goes."""
        message = str(body.get("message", "")).strip()
        if not message:
            emit({"type": "error", "message": "Nothing to send."})
            return
        canvas = body.get("surface") == "canvas"
        if canvas:
            context = canvas_context(body)
        else:
            context = []
            if body.get("screen"):
                context.append(f"The app is showing {shown_page(body)}.")
            if body.get("folder"):
                context.append(f"The Explorations strip shows the \"{body['folder']}\" screen's versions.")
            if body.get("playground"):
                v = body.get("version") or "default"
                m = re.match(r"v(\d+)\.(\d+)$", v)
                what = (f"exploration {m[1]}'s own version" if m[2] == "0" else f"iteration {m[2]} of exploration {m[1]}") if m else "main" if v == "default" else v
                context.append(
                    f"The version on show is {body['playground']} {v} ({what}, {body.get('versionState') or 'shown'})."
                )
        prompt = message + ("\n\n(" + " ".join(context) + ")" if context else "")
        # A starting prompt (composer.js's STARTERS), on the canvas: its rules, and the board's file.
        starter = body.get("starter") if canvas and body.get("starter") in STARTER_RULES else None
        board = f"{starter}-{unique_stamp()}" if starter else None
        if starter:
            prompt += "\n" + starter_rules(starter, f"{DATA_REL}/boards/{board}.json")
        shots = save_attachments(body.get("attachments"))
        if shots:
            emit({"type": "attached", "files": ["/" + p for p, _ in shots]})
            prompt += "\n\nThe person attached " + ("a screenshot" if len(shots) == 1 else f"{len(shots)} screenshots") + \
                ". Read each with the Read tool before you answer:\n" + \
                "\n".join(f"- {p}" + (f": {note}" if note else "") for p, note in shots)
        notes_file, notes = save_notes(body.get("notes"))
        if notes:
            prompt += f"\n\nThe person sent {len(notes)} note" + ("" if len(notes) == 1 else "s") + \
                f", saved in {notes_file}. Read each picture with the Read tool, and set each note's status " + \
                "and reply in that file as you finish it:\n" + "\n".join(describe_note(n) for n in notes)
        before = known_versions()
        mine = set()  # (screen, version) this run made: other tabs' runs make versions too
        tools = {}
        errors = tempfile.TemporaryFile("w+")
        flutter = find_flutter() if ADAPTER == "flutter" else None
        env = dict(os.environ, PLAYGROUND_PORT=str(Handler.port))  # for reload.py
        if flutter:
            env["PATH"] = f"{Path(flutter).parent}:{env.get('PATH', '')}"
        try:
            proc = subprocess.Popen(
                self.command(prompt, body.get("session"), canvas), cwd=ROOT, env=env,
                stdout=subprocess.PIPE, stderr=errors, stdin=subprocess.DEVNULL, text=True, bufsize=1,
            )
            with self.lock:
                self.runs[tab] = proc
        except OSError as e:
            self.claude = None
            emit({"type": "error", "message": f"Couldn't start Claude Code ({e}). Is it installed?"})
            return
        emit({"type": "start"})
        done = False
        new_ones = lambda now: [{"playground": p, "version": v} for p, ids in now.items() for v in ids
                                if v not in before.get(p, []) and (p, v) in mine]
        # Versions that were there before the run and that it changed: updated in place.
        edited = []
        updated = lambda: [{"playground": p, "version": v} for p, v in edited if v in before.get(p, []) and v != "default"]
        for line in proc.stdout:
            try:
                event = json.loads(line)
            except ValueError:
                continue
            kind = event.get("type")
            if kind == "system" and event.get("subtype") == "init":
                emit({"type": "session", "id": event.get("session_id")})
            elif kind == "assistant":
                for part in event.get("message", {}).get("content", []):
                    if part.get("type") == "text" and part.get("text", "").strip():
                        emit({"type": "text", "text": part["text"]})
                    elif part.get("type") == "tool_use":
                        tools[part.get("id")] = (part.get("name"), part.get("input") or {})
                        emit({"type": "tool", "name": part.get("name"), "label": label(part.get("name"), part.get("input") or {})})
            elif kind == "user":
                for part in event.get("message", {}).get("content", []):
                    if not isinstance(part, dict) or part.get("type") != "tool_result":
                        continue
                    name, args = tools.get(part.get("tool_use_id"), (None, {}))
                    if part.get("is_error"):
                        text = part.get("content")
                        text = text if isinstance(text, str) else json.dumps(text)
                        # A reload that failed is Claude's to fix, not a refusal.
                        if name == "Bash" and "reload.py" in str(args.get("command", "")):
                            emit({"type": "tool", "name": "Bash", "label": "The app didn't compile; Claude is fixing it"})
                        else:
                            emit({"type": "refused", "label": label(name, args) if name else "A step"})
                        continue
                    if name in ("Edit", "Write", "MultiEdit") and in_notes(args.get("file_path", "")):
                        continue  # answering a note changes nothing in the app
                    if name in ("Edit", "Write", "MultiEdit", "Bash"):
                        pg, version = playground_of(args.get("file_path", "")) if name != "Bash" else (None, None)
                        reloaded = name == "Bash" and "reload.py" in str(args.get("command", ""))
                        if name == "Bash":
                            mine.update(made_by(result_text(part.get("content"))))
                        elif pg and version:
                            mine.add((pg, version))
                            if (pg, version) not in edited:
                                edited.append((pg, version))
                        emit({"type": "changed", "playground": pg, "version": version, "new": new_ones(known_versions()), "reloaded": reloaded})
            elif kind == "result":
                new = new_ones(known_versions())
                boards = add_boards([board]) if board else []
                if canvas:  # a new exploration made from the canvas goes on it, before the page lays out again
                    add_to_canvas([(x["playground"], x["version"]) for x in new], skip=board_explorations(boards))
                emit({
                    "boards": boards,
                    "type": "done", "ok": not event.get("is_error"), "session": event.get("session_id"),
                    "summary": event.get("result") or "", "new": new, "updated": [] if new else updated(),
                    "cost": event.get("total_cost_usd"),
                    "refused": len(event.get("permission_denials") or []),
                })
                done = True
        proc.wait()
        if canvas and not done:  # stopped before the end: what it made is still the canvas's
            boards = add_boards([board]) if board else []
            add_to_canvas([(x["playground"], x["version"]) for x in new_ones(known_versions())], skip=board_explorations(boards))
        if notes:
            emit({"type": "notes", "notes": note_outcomes(notes_file)})
        errors.seek(0)
        err = errors.read().strip().splitlines()
        errors.close()
        if not done:
            text = " ".join(err).lower()
            if any(w in text for w in ("log in", "login", "/login", "not authenticated", "api key", "unauthorized")):
                emit({"type": "error", "login": True, "message": "Claude Code isn't logged in on this computer. Run claude in a terminal once and log in, then send again."})
            else:
                emit({"type": "error", "message": err[-1] if err else f"Claude stopped (exit {proc.returncode})."})


MOVE_RULES = """You are moving picked versions of the playground into the app, for good. The person
pressed Commit in the playground; this is the "Move a picked version into the app" step of
playground/README.md, done for them.

- Read playground/README.md, playground/RULES.md and the project's CLAUDE.md (if it has one)
  first, and follow the project's conventions: a file that a script writes is changed
  through its script, and so on.
- For each pick, read its version folder and move what it changes into the app's own
  files, so the app on its own (every pick back to main) looks and works as it did with
  the picks running. The app's own file for a screen is the one <data>/screens.json names.
  Where two picks change the same screen, the later one is laid over the earlier one.
- A pick from a component exploration (its versions.json has "component") changes one
  component wherever the app draws it: move it into that component's own code (its
  renderer, or the shared part), once, not into each screen, so every screen gets it. If
  it draws a look-alike as the component, point the look-alike's uses at the component
  and remove the look-alike once nothing uses it.
- A pick's folder may hold design.json: changes made with the canvas's Design dials (each a
  selector, what the dials say and the style properties they set, all steps of the
  project's design system). Carry each into the app's own source where that part is drawn,
  as the system's token where the app has one, for one part or, when the selector names
  only a component, for every use of it.
- Don't change the version folders, index.json, picks.json, versions.json or anything under
  playground/. Don't run git: the playground commits when you're done.
- Move the design, not the version's baggage. A version is built to be tried, not kept,
  so before you finish, make what you moved lean:
  - one copy of anything used more than once: share a part, don't paste it again for
    each place (a screen file that holds the same subtree twice is a sign);
  - only the assets the design uses, copied into the app's own asset folder: never a
    link to a folder outside the project, which a teammate's clone won't have;
  - none of the version's history (its "vN: …" comments, dead code from earlier
    iterations, ids or names marked with version numbers that no longer mean anything);
  - no file over {max_mb} MB: Commit refuses one (playground.json's "commit":
    {{"maxFileMB": …}} sets the limit). If a file can't be made smaller, say why in your
    summary, so the person can decide to raise the limit.
- A version's library/ folder holds the components it proposes, an entry each. Move each
  into the project's library folder (playground.json's "library" "dir") with "status":
  "draft", its "implementations" pointing at where its code now lives, and leave the
  person to review it there. Name the moved code after what it is, not the version.
- If playground.json has "commit": {{"build": [...]}}, the playground runs those commands
  after you finish, to write the app's generated files: change their sources, and run
  them yourself too to check your work.
- When the files are moved, run python3 playground/reload.py and fix any errors it prints.
- Finish with one short paragraph: what moved where.""".replace("<data>", DATA_REL)


def lean_problems(paths):
    """Why these files (paths from the project's top) shouldn't be committed as they
    are: a link out of the project, or a file over the size playground.json allows."""
    problems = []
    limit = float(CONFIG.get("commit", {}).get("maxFileMB", 5))
    for p in paths:
        f = ROOT / p
        if f.is_symlink():
            target = f.resolve()
            if ROOT.resolve() not in target.parents and target != ROOT.resolve():
                problems.append(f"{p} links outside the project, which a clone won't have: copy what it needs instead.")
        elif f.is_file() and f.stat().st_size > limit * 1e6:
            problems.append(f"{p} is {f.stat().st_size / 1e6:.1f} MB, over the {limit:g} MB a file may be (\"commit\": {{\"maxFileMB\"}} in playground.json).")
    return problems


def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True)


def read_json_file(path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def changed_files():
    """{path: status} of what git sees changed, apart from the explorations
    (files git doesn't know under <data>/) and the chat's attachments and notes."""
    entries = git("status", "--porcelain=v1", "-z", "--untracked-files=all").stdout.split("\0")
    out, i = {}, 0
    while i < len(entries):
        e = entries[i]
        i += 1
        if len(e) < 4:
            continue
        status, path = e[:2], e[3:]
        if "R" in status or "C" in status:
            i += 1  # a rename names its old path next
        private = path.startswith(("playground/attachments/", "playground/notes/", "playground/chats/")) or \
            (status == "??" and path.startswith(DATA_REL + "/"))
        if not private:
            out[path] = "A" if status == "??" or "A" in status else "D" if "D" in status else "M"
    return out


def fingerprint(paths):
    """{path: a hash of its contents, or None when it's gone}, to tell which files a move changed."""
    out = {}
    for p in paths:
        f = ROOT / p
        out[p] = hashlib.sha1(f.read_bytes()).hexdigest() if f.is_file() else None
    return out


class Commit:
    """The header's Commit button. Each picked version is moved into the app's own
    files (Claude Code does it, as playground/README.md describes), its pick goes
    back to main, and the change is committed on this computer, on the branch the
    project is on. Nothing is pushed. One commit at a time.

    Claude can write anywhere in the project for this, apart from playground/ (the
    kit, and its rules), the explorations and .git, and it runs only reload.py and
    what playground.json's "commit": {"allow": [...]} adds (a project whose files
    are written by scripts lets it run them). Only the files the move changed are
    committed, unless the person ticks "Also commit the other changes"."""

    def __init__(self, chat):
        self.chat = chat
        self.lock = threading.Lock()
        self.proc = None

    def picks(self):
        order = (read_json_file(INDEX) or {}).get("playgrounds", [])
        out = []
        for pg, version in (read_json_file(PICKS) or {}).items():
            if version == "default" or pg not in order:
                continue
            info = read_json_file(DATA / pg / "versions.json") or {}
            v = next((x for x in info.get("versions", []) if x.get("id") == version), None)
            if v:
                out.append({"playground": pg, "version": version, "title": info.get("title") or pg,
                            "name": v.get("name") or version, "note": v.get("note") or ""})
        return sorted(out, key=lambda p: order.index(p["playground"]))

    def plan(self):
        inside = git("rev-parse", "--is-inside-work-tree")
        if inside.returncode or inside.stdout.strip() != "true":
            return {"git": False, "problems": ["The project isn't a git repository, so there's nothing to commit to."], "picks": [], "other": {}}
        problems = []
        branch = git("branch", "--show-current").stdout.strip()
        if not branch:
            problems.append("The project isn't on a branch (a detached HEAD). Check out a branch first.")
        gitdir = Path(git("rev-parse", "--absolute-git-dir").stdout.strip())
        if any((gitdir / f).exists() for f in ("MERGE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD")):
            problems.append("Git is in the middle of a merge or rebase. Finish it in a terminal first.")
        picks = self.picks()
        if picks and not (self.chat and self.chat.ready()):
            problems.append("Moving a pick into the app needs Claude Code, and chat is off or not installed here.")
        if self.chat and self.chat.runs:
            problems.append("A chat is still working. Wait for it, or stop it, so it doesn't change files mid-commit.")
        names = CONFIG.get("commit", {}).get("keepInStep", [])
        in_step = [n for n in ([names] if isinstance(names, str) else names) if n and n != branch]
        return {"git": True, "branch": branch, "picks": picks, "other": changed_files(), "problems": problems, "inStep": in_step}

    def stop(self):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()

    def run(self, body, emit):
        if not self.lock.acquire(blocking=False):
            emit({"type": "error", "message": "A commit is already running."})
            return
        try:
            self._run(body, emit)
        finally:
            self.proc = None
            self.lock.release()

    def _run(self, body, emit):
        plan = self.plan()
        if plan["problems"]:
            emit({"type": "error", "message": plan["problems"][0]})
            return
        picks, other = plan["picks"], bool(body.get("other"))
        if not picks and not (other and plan["other"]):
            emit({"type": "error", "message": "Nothing to commit: no version is picked, and no other changes are ticked."})
            return
        before = fingerprint(plan["other"])

        if picks:
            emit({"type": "step", "phase": "move", "text": f"Claude is moving {len(picks)} pick{'' if len(picks) == 1 else 's'} into the app."})
            if not self.move(picks, emit):
                return
            if not self.build(emit):
                return
            result = Handler.app.reload()
            moved = [p for p, h in fingerprint(changed_files()).items() if before.get(p, "new") != h]
            errors = list(result.get("errors") or []) + check_paths(moved)
            if not moved and not errors:
                # Nothing moved: the picks stay as they are, so the design isn't lost.
                emit({"type": "error", "message": "The move didn't change any of the app's files, so nothing was committed, and the picks are left as they are."})
                return
            errors += lean_problems(moved)
            if errors:
                emit({"type": "error", "message": "After the move the app has errors or baggage, so nothing was committed. The moved files are left as they are. "
                      + " ".join(errors[:4])})
                return
            size = sum((ROOT / p).stat().st_size for p in moved if (ROOT / p).is_file())
            emit({"type": "step", "phase": "check", "text": f"The app reloads without errors. The move changed {len(moved)} file{'' if len(moved) == 1 else 's'} ({size / 1e6:.1f} MB)."})
            # Each pick goes back to main, which now shows it, and its version is
            # marked as merged. These are the playground's files: never committed.
            # The commit runs in the background, so a pick changed meanwhile stays.
            picked = read_json_file(PICKS) or {}
            for p in picks:
                if picked.get(p["playground"]) == p["version"]:
                    picked[p["playground"]] = "default"
                vfile = DATA / p["playground"] / "versions.json"
                info = read_json_file(vfile) or {}
                for v in info.get("versions", []):
                    if v.get("id") == p["version"]:
                        v["merged"] = time.strftime("%Y-%m-%d")
                write_json(vfile, info)
            write_json(PICKS, dict(sorted(picked.items())))
            write_registry()

        after = fingerprint(changed_files())
        files = sorted(after) if other else sorted(p for p, h in after.items() if before.get(p, "new") != h)
        if not files:
            emit({"type": "error", "message": "The move didn't change any of the app's files, so there's nothing to commit."})
            return
        whole = [p for p in files if p in before and not other]
        if whole:
            emit({"type": "step", "text": f"{len(whole)} file{'' if len(whole) == 1 else 's'} had changes nobody committed, and they go in whole: " + ", ".join(whole[:4])})
        message = ("Playground: " + ", ".join(f"{p['title']} › {p['name']}" for p in picks)) if picks else "Playground: other changes"
        note = str(body.get("note") or "").strip()
        if note:
            message += "\n\n" + note
        if picks:
            message += "\n\n" + "\n".join(f"- {p['playground']} {p['version']}" + (f": {p['note']}" if p["note"] else "") for p in picks)
        emit({"type": "step", "phase": "commit", "text": f"Committing {len(files)} file{'' if len(files) == 1 else 's'} to {plan['branch']}."})
        for step in (("add", "-A", "--", *files), ("commit", "-m", message, "--", *files)):
            r = git(*step)
            if r.returncode:
                out = (r.stderr or r.stdout).strip().splitlines()
                emit({"type": "error", "message": out[-1] if out else f"git {step[0]} failed."})
                return
        sha = git("rev-parse", "--short", "HEAD").stdout.strip()
        self.keep_in_step(plan["branch"], emit)
        emit({"type": "done", "branch": plan["branch"], "commits": [{"sha": sha, "message": message.splitlines()[0]}], "files": files})

    def keep_in_step(self, branch, emit):
        """playground.json's "commit": {"keepInStep": ["main"]}: branches moved up to the
        new commit as well, when the project works on a branch of its own (a worktree)
        but the app is opened, shared or deployed from main. Only a fast-forward: a
        branch with commits of its own is left as it is, and said so. A branch checked
        out in another worktree is moved there, so its files follow."""
        names = CONFIG.get("commit", {}).get("keepInStep", [])
        for name in [names] if isinstance(names, str) else names:
            if not name or name == branch or git("rev-parse", "--verify", "-q", f"refs/heads/{name}").returncode:
                continue
            if git("merge-base", "--is-ancestor", name, "HEAD").returncode:
                emit({"type": "step", "text": f"{name} has commits of its own, so it wasn't moved up: merge {branch} into it by hand."})
                continue
            where, here = None, None
            for line in git("worktree", "list", "--porcelain").stdout.splitlines():
                if line.startswith("worktree "):
                    here = line[9:]
                elif line == f"branch refs/heads/{name}":
                    where = here
            if where:
                r = subprocess.run(["git", "merge", "--ff-only", "-q", git("rev-parse", "HEAD").stdout.strip()],
                                   cwd=where, capture_output=True, text=True)
            else:
                old = git("rev-parse", f"refs/heads/{name}").stdout.strip()
                r = git("update-ref", f"refs/heads/{name}", "HEAD", old)
            if r.returncode:
                out = (r.stderr or r.stdout).strip().splitlines()
                emit({"type": "step", "text": f"Couldn't move {name} up to it" + (f" ({where})" if where else "") + f": {out[-1] if out else 'git said no'}. It's still committed to {branch}."})
            else:
                emit({"type": "step", "phase": "commit", "text": f"{name} moved up to it too" + (f", in {Path(where).name}" if where else "") + "."})

    def build(self, emit):
        """Runs playground.json's "commit": {"build": [...]}, in order, from the project's
        top: the commands that write the app's generated files from its sources (a
        project whose screens are written by scripts), so a move can't leave them
        stale. Each is a list of arguments, or a string split as a shell would."""
        for cmd in CONFIG.get("commit", {}).get("build", []):
            args = shlex.split(cmd) if isinstance(cmd, str) else [str(a) for a in cmd]
            emit({"type": "step", "text": "Running " + " ".join(args)})
            try:
                r = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, timeout=600)
            except (OSError, subprocess.TimeoutExpired) as e:
                emit({"type": "error", "message": f"{' '.join(args)} didn't run ({e}), so nothing was committed."})
                return False
            if r.returncode:
                out = (r.stderr or r.stdout).strip().splitlines()
                emit({"type": "error", "message": f"{' '.join(args)} failed, so nothing was committed. The moved files are left as they are"
                      + (f": {out[-1]}" if out else ".")})
                return False
        return True

    def move(self, picks, emit):
        prompt = "Move these picks into the app, in this order:\n" + "\n".join(
            f"{n}. {p['title']} › {p['name']}: version {p['version']} of {p['playground']} "
            f"(its folder is {DATA_REL}/{p['playground']}/{p['version']}/)" + (f". Its note: {p['note']}" if p["note"] else "")
            for n, p in enumerate(picks, 1))
        own = HERE / "RULES.md"
        rules = MOVE_RULES.format(max_mb=f"{float(CONFIG.get('commit', {}).get('maxFileMB', 5)):g}") + reference_rules() + ("\n\nThis project's own rules for versions (playground/RULES.md):\n\n" + own.read_text().strip() if own.exists() else "")
        cmd = [
            self.chat.claude, "-p", prompt,
            "--output-format", "stream-json", "--verbose",
            "--setting-sources", "project",
            "--strict-mcp-config",
            "--permission-mode", "dontAsk",
            "--permission-prompts", "none",
            "--tools", "Read,Glob,Grep,Edit,Write,Bash",
            "--allowedTools", "Read(./**)", "Edit(./**)", "Write(./**)", "Bash(python3 playground/reload.py:*)",
            *[str(a) for a in CONFIG.get("commit", {}).get("allow", [])],
            *reference_flags(),
            "--disallowedTools", "Edit(playground/**)", "Write(playground/**)", "Edit(.git/**)", "Write(.git/**)",
            f"Edit({DATA_REL}/**)", f"Write({DATA_REL}/**)",
            "--append-system-prompt", rules,
        ]
        if self.chat.model:
            cmd += ["--model", self.chat.model]
        env = dict(os.environ, PLAYGROUND_PORT=str(Handler.port))  # for reload.py
        flutter = find_flutter() if ADAPTER == "flutter" else None
        if flutter:
            env["PATH"] = f"{Path(flutter).parent}:{env.get('PATH', '')}"
        errors = tempfile.TemporaryFile("w+")
        try:
            self.proc = subprocess.Popen(cmd, cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=errors,
                                         stdin=subprocess.DEVNULL, text=True, bufsize=1)
        except OSError as e:
            emit({"type": "error", "message": f"Couldn't start Claude Code ({e})."})
            return False
        ok, summary = False, ""
        for line in self.proc.stdout:
            try:
                event = json.loads(line)
            except ValueError:
                continue
            if event.get("type") == "assistant":
                for part in event.get("message", {}).get("content", []):
                    if part.get("type") == "tool_use" and part.get("name") in ("Edit", "Write", "MultiEdit", "Bash"):
                        emit({"type": "step", "text": label(part.get("name"), part.get("input") or {})})
            elif event.get("type") == "result":
                ok, summary = not event.get("is_error"), event.get("result") or ""
        self.proc.wait()
        errors.seek(0)
        err = errors.read().strip().splitlines()
        errors.close()
        if not ok:
            emit({"type": "error", "message": "Claude couldn't finish the move, so nothing was committed. Any files it changed are left as they are"
                  + (f": {err[-1]}" if err else ".")})
            return False
        if summary.strip():
            emit({"type": "step", "text": summary.strip()})
        return True


def chat_author():
    """Who writes from this computer: git's user.name, else the login name.
    Each chat message records it, so teammates' messages show as theirs once
    chats are shared."""
    global _AUTHOR
    if _AUTHOR is None:
        try:
            name = subprocess.run(["git", "config", "user.name"], cwd=ROOT, capture_output=True, text=True, timeout=5).stdout.strip()
        except (OSError, subprocess.SubprocessError):
            name = ""
        _AUTHOR = name or os.environ.get("USER", "") or "You"
    return _AUTHOR


_AUTHOR = None


def list_chats():
    """Every chat, newest first: the stack in the canvas's chat panel."""
    out = []
    for f in CHATS.glob("*.json") if CHATS.is_dir() else []:
        c = read_json_file(f)
        if isinstance(c, dict) and CHAT_ID.match(str(c.get("id", ""))) and f.stem == c["id"]:
            out.append(c)
    return sorted(out, key=lambda c: str(c.get("updated", "")), reverse=True)


def save_chat(body):
    """Writes one chat (its id, title, Claude session and log). Its first
    save sets when it was made and by whom."""
    cid = str(body.get("id", ""))
    if not CHAT_ID.match(cid) or not isinstance(body.get("log"), list):
        raise ValueError("Not a chat.")
    path = CHATS / f"{cid}.json"
    old = read_json_file(path) or {}
    now = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    chat = {
        "id": cid,
        "title": str(body.get("title") or "")[:120],
        "created": old.get("created") or now,
        "author": old.get("author") or chat_author(),
        "updated": now,
        "session": body.get("session") if isinstance(body.get("session"), str) else None,
        "log": [m for m in body["log"] if isinstance(m, dict)],
    }
    data = json.dumps(chat, indent=1, ensure_ascii=False)
    if len(data.encode()) > MAX_CHAT_BYTES:
        raise ValueError("This chat is too long to save. Start a new one.")
    CHATS.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(data)
    tmp.replace(path)
    return {"id": cid, "updated": now, "author": chat["author"]}


def delete_chat(cid):
    """Moves a chat to the trash, where it stays 14 days (clear_old_trash)."""
    path = CHATS / f"{cid}.json"
    if not CHAT_ID.match(cid) or not path.exists():
        raise ValueError("No such chat.")
    dest = TRASH / f"chat-{unique_stamp()}"
    dest.mkdir(parents=True, exist_ok=True)
    shutil.move(str(path), dest / path.name)
    return {"deleted": cid, "trash": rel(dest)}


def clear_old_trash(days=14):
    """Deletes for good what was deleted from Explorations more than `days` ago."""
    cutoff = time.time() - days * 86400
    for d in TRASH.glob("*") if TRASH.is_dir() else []:
        try:
            if d.is_dir() and d.stat().st_mtime < cutoff:
                shutil.rmtree(d)
        except OSError:
            pass


def tidy(pg, change):
    """Explorations' stars and deletes (POST /playground/explorations). A star is
    kept in the screen's versions.json, on the version's entry. A delete moves
    the version's folder (or, with no version, every exploration of the
    screen) to playground/trash/<stamp>/ with a
    deleted.json saying where it was, so "restore" can put it back. Returns
    (status, reply)."""
    with playground_lock():
        order = (read_json_file(INDEX) or {}).get("playgrounds", [])
        if pg not in order:
            return 404, {"error": f"The {pg} screen has no explorations in {DATA_REL}/index.json."}
        meta_path = DATA / pg / "versions.json"
        meta = read_json_file(meta_path)
        if not isinstance(meta, dict):
            return 404, {"error": f"{DATA_REL}/{pg}/versions.json can't be read."}
        return change(order, meta_path, meta)


def star(pg, version, on):
    def do(order, meta_path, meta):
        if version is None:
            target = meta
        else:
            target = next((v for v in meta.get("versions", []) if v.get("id") == version and version != "default"), None)
            if target is None:
                return 404, {"error": f"{pg} has no version {version!r} to star."}
        if on:
            target["starred"] = True
        else:
            target.pop("starred", None)
        write_json(meta_path, meta)
        return 200, {"starred": on}
    return tidy(pg, do)


def delete(pg, version):
    def do(order, meta_path, meta):
        picks = read_json_file(PICKS) or {}
        stamp = unique_stamp()
        record = {"kind": "version" if version else "exploration", "playground": pg, "pick": picks.get(pg)}
        if version is None:
            src = DATA / pg
            record["position"] = order.index(pg)
            write_json(INDEX, {**(read_json_file(INDEX) or {}), "playgrounds": [x for x in order if x != pg]})
            picks.pop(pg, None)
        else:
            versions = meta.get("versions", [])
            i = next((n for n, v in enumerate(versions) if v.get("id") == version), None)
            if i is None or version == "default":
                return 404, {"error": f"{pg} has no version {version!r} to delete."}
            entry = versions.pop(i)
            # Versions copied from it now come from what it came from.
            record.update(version=version, position=i, entry=entry, children=[])
            for v in versions:
                if v.get("from") == version:
                    record["children"].append(v["id"])
                    if entry.get("from"):
                        v["from"] = entry["from"]
                    else:
                        v.pop("from", None)
            write_json(meta_path, meta)
            if picks.get(pg) == version:
                picks.pop(pg)
            src = DATA / pg / version
        write_json(PICKS, dict(sorted(picks.items())))
        write_registry()  # before the files go, so the app never imports a missing one
        dest = TRASH / stamp / ("folder" if src.is_dir() else "empty")
        dest.parent.mkdir(parents=True, exist_ok=True)
        if src.is_dir():
            shutil.move(str(src), str(dest))
            with contextlib.suppress(OSError):
                src.parent.rmdir()  # the screen's folder, when it was its last exploration
        write_json(TRASH / stamp / "deleted.json", record)
        return 200, {"picks": picks, "trash": stamp}
    return tidy(pg, do) if version is None or version != "default" else (400, {"error": "main is the app itself: it can't be deleted."})


def canvas_delete(body):
    """The canvas's ⌘-click menu (POST /playground/canvas): deletes what a
    frame or a board is, into the trash as Explorations' bin does, and takes
    it off canvas.json. body: {"what": "iteration", "frame": "<screen>/v<N>",
    "version": "v<N>.<n>"}, {"what": "exploration", "frame"} (every iteration
    of it) or {"what": "board", "board": "<id>"}; {"what": "restore", "trash":
    [stamps], "canvas": {"frames": [...], "boards": [...]}} puts it all back
    (the toast's Undo). Returns (status, reply): reply has the trash stamps
    and the canvas.json entries taken off, for the Undo."""
    what = body.get("what")
    doc = read_json_file(CANVAS) or {}
    if what == "restore":
        stamps = [s for s in body.get("trash") or [] if isinstance(s, str)]
        for s in reversed(stamps):  # the last one deleted goes back first, to its place
            if (TRASH / s / "board.json").is_file():
                rec = read_json_file(TRASH / s / "deleted.json") or {}
                BOARDS.mkdir(parents=True, exist_ok=True)
                shutil.move(str(TRASH / s / "board.json"), str(BOARDS / f"{rec.get('board')}.json"))
                shutil.rmtree(TRASH / s, ignore_errors=True)
            else:
                status, reply = restore(s)
                if status != 200:
                    return status, reply
        back = body.get("canvas") or {}
        doc = read_json_file(CANVAS) or {}
        for key in ("frames", "boards"):
            have = {x.get("id") for x in doc.get(key, []) if isinstance(x, dict)}
            add = [x for x in back.get(key, []) if isinstance(x, dict) and x.get("id") not in have]
            if add:
                doc[key] = sorted(doc.get(key, []) + add, key=lambda x: str(x.get("added", "")))
        write_json(CANVAS, doc)
        return 200, {"ok": True}
    if what == "board":
        bid = str(body.get("board") or "")
        if not re.fullmatch(r"[\w-]+", bid) or not (BOARDS / f"{bid}.json").is_file():
            return 404, {"error": "That board isn't there any more."}
        stamp = unique_stamp()
        (TRASH / stamp).mkdir(parents=True, exist_ok=True)
        shutil.move(str(BOARDS / f"{bid}.json"), str(TRASH / stamp / "board.json"))
        write_json(TRASH / stamp / "deleted.json", {"kind": "board", "board": bid})
        taken = [b for b in doc.get("boards", []) if isinstance(b, dict) and b.get("id") == bid]
        write_json(CANVAS, {**doc, "boards": [b for b in doc.get("boards", []) if b not in taken]})
        return 200, {"trash": [stamp], "canvas": {"boards": taken}}
    frame = str(body.get("frame") or "")
    pg, _, major = frame.rpartition("/")
    if what not in ("iteration", "exploration") or not re.fullmatch(r"[\w.-]+", pg) or not re.fullmatch(r"v\d+", major):
        return 400, {"error": "That isn't a frame on the canvas."}
    meta = read_json_file(DATA / pg / "versions.json") or {}
    mine = [v["id"] for v in meta.get("versions", []) if isinstance(v, dict) and str(v.get("id", "")).startswith(major + ".")]
    gone = mine if what == "exploration" else [v for v in mine if v == body.get("version")]
    if not gone:
        return 404, {"error": f"{frame} has no {body.get('version') or 'iterations'} to delete."}
    stamps = []
    for v in gone:
        status, reply = delete(pg, v)
        if status != 200:
            return status, {**reply, "trash": stamps}
        stamps.append(reply["trash"])
    taken = []
    if len(gone) == len(mine):  # nothing of it left: off the canvas too
        taken = [f for f in doc.get("frames", []) if isinstance(f, dict) and f.get("id") == frame]
        write_json(CANVAS, {**doc, "frames": [f for f in doc.get("frames", []) if f not in taken]})
    return 200, {"trash": stamps, "canvas": {"frames": taken}}


def restore(stamp):
    """Puts back what a delete moved to the trash, where it was."""
    if not re.fullmatch(r"[\w-]+", str(stamp)):
        return 400, {"error": "That isn't something in the trash."}
    where = TRASH / stamp
    record = read_json_file(where / "deleted.json")
    if not isinstance(record, dict):
        return 404, {"error": "It isn't in the trash any more."}
    pg, version = record["playground"], record.get("version")
    with playground_lock():
        index = read_json_file(INDEX) or {"playgrounds": []}
        order = index.get("playgrounds", [])
        picks = read_json_file(PICKS) or {}
        dest = DATA / pg / version if version else DATA / pg
        if record["kind"] == "exploration" and (dest.exists() or pg in order):
            return 409, {"error": f"{DATA_REL}/{pg}/ is there again, so it can't be put back."}
        if record["kind"] == "version":
            meta_path = DATA / pg / "versions.json"
            meta = read_json_file(meta_path)
            if pg not in order or not isinstance(meta, dict):
                return 409, {"error": f"Its screen's explorations, {pg}, aren't there any more."}
            versions = meta.setdefault("versions", [])
            if dest.exists() or any(v.get("id") == version for v in versions):
                return 409, {"error": f"{pg} has a {version} again, so it can't be put back."}
            versions.insert(min(record["position"], len(versions)), record["entry"])
            for v in versions:
                if v.get("id") in record.get("children", []):
                    v["from"] = version
            write_json(meta_path, meta)
        else:
            order.insert(min(record["position"], len(order)), pg)
            write_json(INDEX, {**index, "playgrounds": order})
        if (where / "folder").is_dir():
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(where / "folder"), str(dest))
        if record.get("pick") and picks.get(pg, "default") == "default":
            picks[pg] = record["pick"]
            write_json(PICKS, dict(sorted(picks.items())))
        write_registry()
        shutil.rmtree(where, ignore_errors=True)
        return 200, {"picks": picks}


# ---- Files ------------------------------------------------------------------------
# The Files panel: the project's folder, one for one, as VS Code's explorer
# shows it. Read only, and never outside the project (a link inside it is
# shown, but not followed out). The page asks again every few seconds, so it
# follows the folder whoever changes it, Claude included.

FILES_HIDDEN = {".git", ".DS_Store"}
FILES_READ_MAX = 1024 * 1024
FILES_FIND_MAX = 20000
IMAGE_FILE = re.compile(r"\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)$", re.I)


def inside(relpath=""):
    """The absolute path of `relpath` in the project, or ValueError. Links
    aren't followed, so a path is judged by where it's written."""
    root = os.path.abspath(ROOT)
    p = os.path.abspath(os.path.join(root, relpath or ""))
    if p != root and not p.startswith(root + os.sep):
        raise ValueError("outside the project")
    return p


def reveal(relpath):
    """Shows a project file in Finder, selected (or in the system's file
    manager: Explorer, or its folder on Linux)."""
    p = inside(relpath)
    if not os.path.exists(p):
        raise ValueError("No such file")
    if sys.platform == "darwin":
        subprocess.Popen(["open", "-R", p])
    elif os.name == "nt":
        subprocess.Popen(["explorer", f"/select,{p}"])
    else:
        subprocess.Popen(["xdg-open", p if os.path.isdir(p) else os.path.dirname(p)])
    return {"ok": True}


def natural(name):
    return [int(s) if s.isdigit() else s.casefold() for s in re.split(r"(\d+)", name)]


def list_folder(relpath=""):
    """One folder's entries, folders first: [{name, path, dir, mtime}]."""
    folder = inside(relpath)
    out = []
    with os.scandir(folder) as it:
        for e in it:
            if e.name in FILES_HIDDEN:
                continue
            try:
                is_dir = e.is_dir()  # follows a link, to say what it points at
                mtime = int(e.stat().st_mtime * 1000)
            except OSError:
                is_dir, mtime = False, 0
            out.append({"name": e.name, "path": f"{relpath}/{e.name}" if relpath else e.name, "dir": is_dir, "mtime": mtime})
    return sorted(out, key=lambda e: (not e["dir"], natural(e["name"])))


def file_marks():
    """git's marks: each changed path with its two-letter status code (" M",
    "A ", "??" …), the paths git ignores, and the branch. A folder git reports
    whole ends in "/". --no-optional-locks keeps git from touching its index."""
    r = git("--no-optional-locks", "status", "--porcelain=v1", "-z", "--ignored")
    if r.returncode != 0:
        return {"repo": False, "branch": None, "changes": {}, "ignored": []}
    parts, changes, ignored, i = r.stdout.split("\0"), {}, [], 0
    while i < len(parts):
        p = parts[i]
        i += 1
        if len(p) < 4:
            continue
        code, path = p[:2], p[3:]
        if code[0] in "RC":
            i += 1  # the old name follows
        if code == "!!":
            ignored.append(path)
        else:
            changes[path] = code
    branch = git("rev-parse", "--abbrev-ref", "HEAD").stdout.strip() or None
    return {"repo": True, "branch": None if branch == "HEAD" else branch, "changes": changes, "ignored": ignored}


def all_files():
    """Every file git doesn't ignore (every file, if it isn't a git repo), to
    find one by name."""
    r = git("--no-optional-locks", "ls-files", "-z", "--cached", "--others", "--exclude-standard")
    if r.returncode == 0:
        files = sorted(set(filter(None, r.stdout.split("\0"))))
    else:
        files = []
        for top, dirs, names in os.walk(ROOT):
            dirs[:] = [d for d in dirs if d not in FILES_HIDDEN]
            files += [os.path.relpath(os.path.join(top, n), ROOT).replace(os.sep, "/") for n in names if n not in FILES_HIDDEN]
            if len(files) > FILES_FIND_MAX:
                break
    files = [f for f in files if os.path.exists(os.path.join(ROOT, f))]  # not the ones deleted since
    return {"files": files[:FILES_FIND_MAX], "more": max(0, len(files) - FILES_FIND_MAX)}


def read_file(relpath):
    """A file for the reader: {kind: "text", text, truncated}, {kind: "image",
    url} (served as any file here is) or {kind: "binary"}, with its size and
    when it last changed."""
    p = inside(relpath)
    st = os.stat(p)
    base = {"path": relpath, "size": st.st_size, "mtime": int(st.st_mtime * 1000)}
    if os.path.isdir(p):
        return {**base, "kind": "folder"}
    if IMAGE_FILE.search(relpath):
        return {**base, "kind": "image", "url": "/" + urllib.parse.quote(relpath) + f"?v={base['mtime']}"}
    with open(p, "rb") as f:
        data = f.read(FILES_READ_MAX)
    if b"\0" in data[:8000]:
        return {**base, "kind": "binary"}
    return {**base, "kind": "text", "text": data.decode("utf-8", "replace"), "truncated": st.st_size > FILES_READ_MAX}


class MainWatch:
    """Tells the canvas when main changes (/playground/events), so it doesn't
    have to ask every few seconds. One thread looks at frozen.main_stamp(),
    whatever the number of pages open, and only while at least one is; each
    page's stream waits on it."""

    EVERY = 1.0  # seconds between looks

    def __init__(self):
        self.cond = threading.Condition()
        self.stamp = None
        self.seq = 0  # goes up by one each time the stamp changes
        self.pages = 0
        self.thread = None

    def join(self):
        with self.cond:
            self.pages += 1
            if self.thread is None or not self.thread.is_alive():
                self.thread = threading.Thread(target=self.run, name="main-watch", daemon=True)
                self.thread.start()

    def leave(self):
        with self.cond:
            self.pages -= 1

    def run(self):
        while True:
            with self.cond:
                if self.pages <= 0:
                    self.thread = None
                    return
            try:
                stamp = frozen.main_stamp()
            except Exception:  # git missing or busy: look again next time
                stamp = None
            if stamp and stamp != self.stamp:
                with self.cond:
                    self.stamp = stamp
                    self.seq += 1
                    self.cond.notify_all()
            time.sleep(self.EVERY)

    def wait(self, seq, timeout):
        """The stamp once it's newer than `seq` (or after `timeout`): (seq, stamp)."""
        with self.cond:
            self.cond.wait_for(lambda: self.seq != seq, timeout)
            return self.seq, self.stamp


MAIN_WATCH = MainWatch()


class Handler(SimpleHTTPRequestHandler):
    chat = None  # a Chat, or None with --no-chat
    commit = None  # the Commit button's Commit
    app = None   # the FlutterApp or CommandApp
    port = 8820

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        # The app's frame (another port) loads the screenshot library from here
        # to draw captures of itself.
        if self.path.startswith("/playground/src/vendor/"):
            self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def log_message(self, fmt, *args):
        if not (args and isinstance(args[0], str) and args[0].startswith(("GET ", "HEAD "))):
            super().log_message(fmt, *args)

    def json(self, status, value):
        data = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def events(self):
        """Server-sent events for the canvas: `main` with main's stamp, at once
        and then whenever it changes (MainWatch); a comment every 15 s keeps
        the stream open, and finds out when the page has gone."""
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        MAIN_WATCH.join()
        try:
            seq = 0
            while True:
                now, stamp = MAIN_WATCH.wait(seq, 15)
                if now != seq and stamp:
                    seq = now
                    self.wfile.write(f"event: main\ndata: {json.dumps({'stamp': stamp})}\n\n".encode())
                else:
                    self.wfile.write(b": still here\n\n")
                self.wfile.flush()
        except OSError:  # the page went away (BrokenPipeError, ConnectionResetError)
            pass
        finally:
            MAIN_WATCH.leave()

    def do_GET(self):
        path, _, query = self.path.partition("?")
        if path == "/":
            self.send_response(302)  # keeping ?playground=…&v=…, which opens on a version
            page = f"/{HERE.name}/canvas.html" if (HERE / "canvas.html").exists() and CONFIG.get("canvas", {}).get("home", True) else f"/{HERE.name}/"
            self.send_header("Location", page + (f"?{query}" if query else ""))
            self.end_headers()
            return
        if path == "/playground/chat":
            why = "off" if self.chat is None else None if self.chat.ready() else "missing"
            self.json(200, {"enabled": why is None, "why": why, "folder": str(ROOT), "notes": True, "tabs": MAX_RUNS})
            return
        if path == "/playground/chats":
            self.json(200, {"you": chat_author(), "chats": list_chats()})
            return
        if path == "/playground/app":
            self.json(200, self.app.status())
            return
        if path == "/playground/commit":
            self.json(200, self.commit.plan())
            return
        if path == "/playground/frozen":
            self.json(200, frozen.listing())
            return
        if path == "/playground/main":
            # What main is now (frozen.main_stamp): the canvas runs Main again when it changes.
            self.json(200, {"stamp": frozen.main_stamp()})
            return
        if path == "/playground/events":
            self.events()
            return
        if path == "/playground/design":
            # A version's dial changes (system.py's design.json).
            q = urllib.parse.parse_qs(query)
            self.json(200, {"styles": system.styles(q.get("playground", [""])[0], q.get("version", [""])[0])})
            return
        if path == "/playground/system":
            # The design system's scales, for the canvas's Properties (system.py).
            try:
                self.json(200, system.load() or {})
            except (ValueError, KeyError) as e:
                self.json(200, {"error": f"The design system couldn't be read: {e}"})
            return
        if path == "/playground/thumbs" and "canvas" in urllib.parse.parse_qs(query):
            # The canvas's own pictures: {key: time}, key "main" or <screen>/<version>.
            folder = THUMBS / "_canvas"
            self.json(200, {p.relative_to(folder).with_suffix("").as_posix(): int(p.stat().st_mtime * 1000)
                            for p in folder.rglob("*.png")} if folder.is_dir() else {})
            return
        if path == "/playground/thumbs":
            self.json(200, {f"{p.parent.name}/{p.stem}": int(p.stat().st_mtime * 1000)
                            for p in THUMBS.glob("*/*.png")} if THUMBS.is_dir() else {})
            return
        if path.startswith("/playground/files"):
            self.files(path, urllib.parse.parse_qs(query, keep_blank_values=True))
            return
        if path == "/playground/library/check":
            q = urllib.parse.parse_qs(query)
            self.json(*self.library_check(q.get("pg", [""])[0], q.get("v", [""])[0]))
            return
        if path == "/playground/library":
            import library  # the scan, here only when the panel asks
            try:
                self.json(200, library.library())
            except (OSError, ValueError, re.error) as e:
                self.json(500, {"error": f"The library couldn't be scanned: {e}"})
            return
        super().do_GET()

    # A version's library check, kept while nothing it reads has changed.
    CHECKS = {}

    def library_check(self, pg, v):
        import library
        folder = DATA / pg / v
        if not re.fullmatch(r"[\w.-]+", pg or "") or not re.fullmatch(r"v\d+\.\d+", v or "") or not folder.is_dir():
            return 404, {"error": "No such version."}
        def newest(paths):
            return max((p.stat().st_mtime for p in paths if p.is_file()), default=0)
        lib_dir = ROOT / CONFIG.get("library", {}).get("dir", "library")
        stamp = (newest(folder.rglob("*")), newest(lib_dir.glob("*.json")) if lib_dir.is_dir() else 0, int(time.time() // 30))
        hit = self.CHECKS.get((pg, v))
        if hit and hit[0] == stamp:
            return 200, hit[1]
        try:
            result = library.check(pg, v)
        except (ValueError, SystemExit, OSError, re.error) as e:
            return 200, {"version": f"{pg}/{v}", "error": str(e), "findings": [], "proposed": []}
        self.CHECKS[(pg, v)] = (stamp, result)
        return 200, result

    def files(self, path, q):
        """The Files panel's reads. /playground/files/poll?d=<folder>&d=… is
        git's marks with the listing of each folder named (the open ones), which
        the page asks for every few seconds."""
        try:
            if path == "/playground/files/poll":
                dirs = {}
                for d in q.get("d", [])[:400]:
                    with contextlib.suppress(OSError):
                        dirs[d] = list_folder(d)
                self.json(200, {"root": str(ROOT), "marks": file_marks(), "dirs": dirs})
            elif path == "/playground/files/all":
                self.json(200, all_files())
            elif path == "/playground/files/read":
                self.json(200, read_file(q.get("path", [""])[0]))
            else:
                self.send_error(404)
        except ValueError:
            self.send_error(403, "Outside the project")
        except OSError as e:
            self.json(404, {"error": str(e)})

    def read_json(self, limit=64 * 1024 * 1024):
        size = int(self.headers.get("Content-Length", 0))
        if size > limit:
            raise ValueError("too big")
        return json.loads(self.rfile.read(size) or b"null")

    def from_panel(self, kinds=("chat",)):
        """Only the playground's own page (or reload.py, with no Origin) may post:
        the panel's header, a JSON body, and this server's origin if any. Another
        website can't send the header without a preflight, which isn't answered."""
        origin = self.headers.get("Origin")
        allowed = {f"http://localhost:{self.port}", f"http://127.0.0.1:{self.port}"}
        return (
            self.headers.get("X-Playground") in kinds
            and self.headers.get("Content-Type", "").startswith("application/json")
            and (origin is None or origin in allowed)
        )

    def do_POST(self):
        path = self.path.split("?")[0]
        if path == "/playground/picks":
            if not self.from_panel(("picks",)):
                self.send_error(403)
            else:
                self.save_picks()
        elif path == "/playground/app/reload":
            if not self.from_panel(("reload", "chat")):
                self.send_error(403)
                return
            try:
                body = self.read_json() or {}
            except ValueError:
                body = {}
            self.json(200, self.app.reload(restart=bool(isinstance(body, dict) and body.get("restart"))))
        elif path in ("/playground/frozen/sync", "/playground/frozen/open"):
            # The canvas's frozen copies (frozen.py): freeze what isn't yet, or
            # serve one on a port of its own.
            if not self.from_panel(("frozen",)):
                self.send_error(403)
                return
            try:
                body = self.read_json() or {}
            except ValueError:
                body = {}
            if not isinstance(body, dict):
                body = {}
            if path.endswith("/sync"):
                self.json(200, {"enabled": frozen.enabled(), "versions": frozen.sync()})
                return
            port = frozen.open_copy(str(body.get("key", "")))
            self.json(200 if port else 404, {"port": port})
        elif path == "/playground/files/reveal":
            # The file reader's Open: the file in Finder (or the system's file manager).
            if not self.from_panel(("files",)):
                self.send_error(403)
                return
            try:
                body = self.read_json() or {}
                self.json(200, reveal(str(body.get("path") or "")))
            except (ValueError, OSError) as e:
                self.json(400, {"error": str(e)})
        elif path == "/playground/design":
            # The canvas's Design dials: save a part's changes in its version.
            if not self.from_panel(("design",)):
                self.send_error(403)
                return
            try:
                body = self.read_json()
                self.json(200, system.save(body if isinstance(body, dict) else {}))
            except ValueError as e:
                self.json(400, {"error": str(e)})
        elif path == "/playground/thumbs":
            if not self.from_panel(("thumbs",)):
                self.send_error(403)
            else:
                self.save_thumb()
        elif path == "/playground/canvas":
            # The canvas's ⌘-click menu: delete an iteration, an exploration or a board, and Undo.
            if not self.from_panel(("canvas",)):
                self.send_error(403)
                return
            if self.commit.lock.locked():
                self.json(409, {"error": "A commit is running. Wait for it to finish."})
                return
            try:
                body = self.read_json()
                assert isinstance(body, dict)
            except (ValueError, AssertionError):
                self.send_error(400)
                return
            status, reply = canvas_delete(body)
            if status == 200:
                self.log_message("Canvas: %s %s", body.get("what"), body.get("frame") or body.get("board") or "")
            self.json(status, reply)
        elif path == "/playground/explorations":
            if not self.from_panel(("explorations",)):
                self.send_error(403)
            else:
                self.tidy_explorations()
        elif path == "/playground/commit":
            if not self.from_panel(("commit",)):
                self.send_error(403)
            else:
                self.run_commit()
        elif path in ("/playground/chats/save", "/playground/chats/delete"):
            # The chat hub (composer.js): works with chat off too, so the stack can be read and tidied.
            if not self.from_panel(("chats",)):
                self.send_error(403)
                return
            try:
                body = self.read_json(MAX_CHAT_BYTES + 65536)
                if not isinstance(body, dict):
                    raise ValueError("Not a chat.")
                self.json(200, save_chat(body) if path.endswith("/save") else delete_chat(str(body.get("id", ""))))
            except (ValueError, OSError) as e:
                self.json(400, {"error": str(e)})
        elif path in ("/playground/chat", "/playground/chat/stop"):
            if self.chat is None:
                self.send_error(404, "Chat is off: start the server without --no-chat")
            elif not self.chat.ready():
                self.json(503, {"error": "Claude Code isn't installed on this computer."})
            elif not self.from_panel():
                self.send_error(403)
            elif path.endswith("/stop"):
                try:
                    body = self.read_json()
                except ValueError:
                    body = None
                tab = body.get("tab") if isinstance(body, dict) else None
                self.chat.stop(str(tab) if tab else None)
                self.json(200, {"stopped": True})
            else:
                self.run_chat()
        else:
            self.send_error(404)

    def save_picks(self):
        try:
            picks = self.read_json()
            versions = known_versions()
            if not isinstance(picks, dict) or not all(pg in versions and v in versions[pg] for pg, v in picks.items()):
                raise ValueError
        except (ValueError, OSError, KeyError):
            self.send_error(400, f"Picks must name a screen in {DATA_REL}/index.json and one of its versions")
            return
        write_json(PICKS, dict(sorted(picks.items())))
        self.log_message("Saved playground picks: %s", ", ".join(f"{pg} {v}" for pg, v in sorted(picks.items())) or "none")
        self.send_response(204)
        self.end_headers()

    def save_thumb(self):
        """A version's picture, from the page: {"screen", "version", "png"} (base64),
        kept in playground/thumbs/<screen>/<version>.png for Explorations' preview.
        Or a component's, for the Library: {"component", "screen", "png"}, kept in
        playground/thumbs/_library/<component>.png, with the screen it was taken
        on in _library/where.json."""
        try:
            body = self.read_json(8 * 1024 * 1024)
            if isinstance(body, dict) and "component" in body:
                self.save_component_thumb(body)
                return
            if isinstance(body, dict) and "canvas" in body:
                self.save_canvas_thumb(body)
                return
            screen, version = str(body["screen"]), str(body["version"])
            assert re.fullmatch(r"[\w-]+", screen) and re.fullmatch(r"default|v\d+\.\d+|[a-z0-9]+", version)
            data = base64.b64decode(str(body["png"]), validate=True)
            assert data.startswith(b"\x89PNG")
        except (ValueError, AssertionError, KeyError, TypeError, binascii.Error):
            self.send_error(400)
            return
        (THUMBS / screen).mkdir(parents=True, exist_ok=True)
        (THUMBS / screen / f"{version}.png").write_bytes(data)
        self.send_response(204)
        self.end_headers()

    def save_canvas_thumb(self, body):
        """A frame's picture, from the canvas: {"canvas": "main" | "<screen>/<version>" | "board/<item>",
        "png"}, kept in playground/thumbs/_canvas/. An exploration's is its frozen
        copy's, so it never goes out of date; main's is retaken as main runs."""
        key = str(body["canvas"])
        if not re.fullmatch(r"main|[\w-]+/v\d+\.\d+|board/[\w-]+", key):  # board/<item>: a board's own (canvas.js)
            raise ValueError("bad key")
        data = base64.b64decode(str(body["png"]), validate=True)
        if not data.startswith(b"\x89PNG"):
            raise ValueError("not a PNG")
        path = THUMBS / "_canvas" / f"{key}.png"
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_bytes(data)
        tmp.replace(path)
        self.send_response(204)
        self.end_headers()

    def save_component_thumb(self, body):
        component, screen = str(body["component"]), str(body.get("screen", ""))
        if not re.fullmatch(r"[\w.-]+", component) or component.startswith(".") or not re.fullmatch(r"[\w-]*", screen):
            raise ValueError("bad name")
        data = base64.b64decode(str(body["png"]), validate=True)
        if not data.startswith(b"\x89PNG"):
            raise ValueError("not a PNG")
        folder = THUMBS / "_library"
        folder.mkdir(parents=True, exist_ok=True)
        (folder / f"{component}.png").write_bytes(data)
        where = folder / "where.json"
        with playground_lock():
            known = json.loads(where.read_text()) if where.is_file() else {}
            known[component] = screen
            where.write_text(json.dumps(known, indent=1, sort_keys=True) + "\n")
        self.send_response(204)
        self.end_headers()

    def tidy_explorations(self):
        """Explorations' star and delete buttons, and the toast's Undo:
        {"action": "star", "playground", "version"?, "starred"},
        {"action": "delete", "playground", "version"?} or {"action": "restore", "trash"}."""
        try:
            body = self.read_json()
            assert isinstance(body, dict)
            action, pg, version = body.get("action"), body.get("playground"), body.get("version")
            assert action in ("star", "delete", "restore")
            assert action == "restore" or (isinstance(pg, str) and (version is None or isinstance(version, str)))
        except (ValueError, AssertionError):
            self.send_error(400)
            return
        if action != "star" and self.commit.lock.locked():
            self.json(409, {"error": "A commit is running. Wait for it to finish."})
            return
        status, reply = (star(pg, version, bool(body.get("starred"))) if action == "star"
                         else delete(pg, version) if action == "delete" else restore(body.get("trash")))
        if status == 200 and action != "star":
            self.log_message("%s %s", "Deleted" if action == "delete" else "Restored", f"{pg} {version or ''}".strip() if pg else body.get("trash"))
        self.json(status, reply)

    def run_commit(self):
        try:
            body = self.read_json()
            assert isinstance(body, dict)
        except (ValueError, AssertionError):
            self.send_error(400)
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson")
        self.end_headers()
        self.log_message("Commit: %s", ", ".join(f"{p['playground']} {p['version']}" for p in self.commit.picks()) or "other changes")

        def emit(event):
            try:
                self.wfile.write((json.dumps(event) + "\n").encode())
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass  # the page went away: the commit carries on and finishes

        self.commit.run(body, emit)

    def run_chat(self):
        try:
            body = self.read_json()
            assert isinstance(body, dict)
        except (ValueError, AssertionError):
            self.send_error(400)
            return
        tab = str(body.get("tab") or "chat")[:40]
        why = self.chat.claim(tab)
        if why:
            self.json(409, {"error": why})
            return
        try:
            self.send_response(200)
            self.send_header("Content-Type", "application/x-ndjson")
            self.end_headers()
            self.log_message("Chat: %s", str(body.get("message", ""))[:120])

            def emit(event):
                try:
                    self.wfile.write((json.dumps(event) + "\n").encode())
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    self.chat.stop(tab)  # the panel went away: stop the run

            self.chat.run(tab, body, emit)
        finally:
            self.chat.release(tab)


def main():
    parser = argparse.ArgumentParser(description=f"Serve the {NAME} playground (see the top of this file).")
    parser.add_argument("port", nargs="?", type=int, default=CONFIG.get("port", 8820))
    parser.add_argument("--open", action="store_true", help="open the playground in the browser")
    parser.add_argument("--no-chat", action="store_true", help="don't let the Claude panel run Claude Code")
    parser.add_argument("--model", help="the model Claude Code uses for chat (default: your Claude Code default)")
    parser.add_argument("--app-port", type=int, default=CONFIG.get("app", {}).get("port", 8821), help="the port the app is served on")
    args = parser.parse_args()
    sys.stdout.reconfigure(line_buffering=True)  # so its lines show at once in a log too
    url = f"http://localhost:{args.port}"
    Handler.port = args.port
    Handler.chat = None if args.no_chat else Chat(args.model)
    Handler.commit = Commit(Handler.chat)
    clear_old_attachments()
    clear_old_trash()
    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), partial(Handler, directory=str(ROOT)))
    except OSError as e:
        if e.errno != errno.EADDRINUSE:
            raise
        print(f"Port {args.port} is already in use, so the playground may already be running: {url}")
        print(f"If it's something else, give another port: python3 playground/serve.py {args.port + 2} --app-port {args.app_port + 2}")
        if args.open:
            webbrowser.open(url)
        return
    Handler.app = make_app(args.app_port)
    Handler.app.start()

    def on_signal(*_):  # a kill or a closed terminal stops the app too, as Ctrl+C does
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, on_signal)
    signal.signal(signal.SIGHUP, on_signal)
    print(f"{NAME} playground: {url}  (picks are saved to {DATA_REL}/picks.json)")
    how = "flutter run -d web-server" if ADAPTER == "flutter" else CONFIG.get("app", {}).get("command", "no command")
    print(f"The app is starting on port {args.app_port} ({how}); the page shows it when it's ready.")
    if Handler.chat is None:
        print("Chat is off (--no-chat).")
    elif Handler.chat.claude:
        print(f"Chat is on, with {Handler.chat.claude}. Claude writes only under {DATA_REL}/.")
    else:
        print("Chat is waiting for Claude Code: the Claude panel says how to install it.")
    print("Press Ctrl+C to stop.")
    if args.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        Handler.commit.stop()
        Handler.app.stop()


if __name__ == "__main__":
    main()
