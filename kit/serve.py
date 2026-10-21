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

It's `python3 -m http.server` over the project with three additions:

- The app. It runs the app on --app-port ("app.port" in playground.json) and
  keeps it, so the playground page can show it in a frame and reload it when
  a version changes (POST /playground/app/reload, which playground/reload.py
  calls too). A Flutter project runs `flutter run -d web-server` and
  hot-reloads; a web project runs its own dev server ("app.command"), which
  reloads changed files itself. Before every reload the registry, the list
  of versions the app compiles in, is written again.

- Picks. The Explorations panel's "Use this version" posts the picks here,
  and they're written to <data>/picks.json. Only picks that name an
  exploration in <data>/index.json and one of its versions are kept.

- Chat (on unless --no-chat, when Claude Code is on this computer). The Claude
  panel posts a prompt here, and this runs Claude Code headless (`claude -p`)
  in the project, using your own Claude login, and streams what it does back to
  the panel as lines of JSON. Claude is locked down: it can read the project,
  write only under <data>/, and run only playground/new.py, duplicate.py and
  reload.py. Anything else is refused without asking
  (--permission-mode dontAsk), and your own Claude settings and MCP servers
  aren't loaded. Only the playground's own page can call it: the request must
  come from this server's origin with the panel's header. Each of the panel's
  chat tabs can have one run going, up to MAX_RUNS at once, and each is stopped
  on its own. PLAYGROUND_CLAUDE names another `claude` to run (for testing).

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
import errno
import json
import os
import re
import secrets
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from pglib import ADAPTER, CONFIG, DATA, HERE, PICKS, ROOT, VERSION_FILE, known_versions, rel, write_json, write_registry

ATTACHMENTS = HERE / "attachments"
NOTES = HERE / "notes"
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


def chat_rules():
    """What Claude is told on every run, after Claude Code's own instructions:
    the kit's rules, then the project's own (playground/RULES.md), read
    fresh so an edit to them counts at the next message."""
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
  python3 playground/duplicate.py and python3 playground/reload.py.
- Explorations are kept by screen: {DATA_REL}/<screen>/<exploration>/<version>/,
  where <screen> is an id in {DATA_REL}/screens.json.
  An exploration's id is <screen>/<exploration>, as in {DATA_REL}/index.json.
- A new idea for an existing exploration is a new version: run
  python3 playground/duplicate.py <screen>/<exploration> <version to start from> "<short name>"
  starting from the version the person is looking at, unless they say otherwise.
  Copying "default" copies the app's own file for the screen into the version, with a
  {VERSION_FILE} that draws the copy in its place. Then change only the new version's folder.
- A new idea that fits no exploration of that screen starts a new exploration:
  python3 playground/new.py <screen> <exploration> "<Title>" "<what it tries, one sentence>"
  then duplicate its default and change the copy.
{VERSION_RULES[ADAPTER]}
- After changing a version, run python3 playground/reload.py. It reloads the app
  and prints any errors: fix them before you finish. A reload error about a
  version you didn't touch is still yours to report, not to fix.
- A follow-up in this conversation ("make it bigger") changes the version you made
  in this conversation, in place. Never change a version you didn't make in this
  conversation unless the person asks for exactly that.
- Write what the version changes in its "note" in versions.json, in one or two
  plain sentences. Keep the JSON style: short arrays and objects on one line.
- Other chats may be working in {DATA_REL}/ at the same time as you, in their own
  versions. Change versions.json and index.json only with the Edit tool (never Write
  them whole), so you don't wipe out a version another chat has just added, and
  leave versions you didn't make alone. A reload error in a version another chat is
  making may show up in your reload too: report it, don't fix it.
- Finish with one or two sentences saying what you made and which version it is.
- The person may attach screenshots: captures of part of the app, with a note naming
  the screen and the parts of it the capture covers, or images of their own. Read
  each one with the Read tool before you answer. Don't change or delete files in
  playground/attachments/.
- The person may send notes: several at once, each pinned to a part or an area of a
  screen, with a picture of it. They're listed in the prompt (with where the part was
  built, when the app can say) and saved in a notes.json under playground/notes/. Read
  each note's picture. Work through them as one batch: notes on the same exploration go
  into one new version, started from the version the note was made on (or, as a
  follow-up, the version you made in this conversation); notes on a screen with no
  exploration start one, as above. A "question" note asks something: answer it, and
  change nothing unless it asks you to. Reload and fix errors before you answer.
  As you finish each note, set its "status" and "reply" in that notes.json, changing
  nothing else in the file: "done" with one plain sentence saying what you changed and
  in which version (or the answer to a question); "question" with what you need to know
  before you can do it (and do nothing for it yet); or "skipped" with why. The person
  sees the reply on the note's pin. Don't delete the file or its pictures.
- If the person asks to use, keep or pick a version, or to "make it the real thing",
  don't edit {DATA_REL}/picks.json and don't make a new version. Tell them to press
  "Use this version" at the foot of the Explorations panel on the left, which makes it
  what the playground runs. If it's already picked, say so. Moving a version into the
  app for good is done in Claude Code outside this chat (the prototype-playground
  skill), so say that too.
- Two explorations' picked versions can change the same screen: the later one in
  index.json gets the earlier one's screen as `below`, and a whole copy hides it. So
  change only what the idea needs, and wrap `below` where you can rather than copying
  the whole screen.
"""
    if own:
        rules += "\nThis project's own rules (playground/RULES.md):\n\n" + own + "\n"
    return rules


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
        where += f"; exploration \"{note['playground']}\", version \"{note['version'] or 'default'}\""
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
    """(exploration, version) for a file under <data>/<screen>/<exploration>/<version>/."""
    try:
        parts = Path(path).resolve().relative_to(DATA).parts
    except ValueError:
        return None, None
    if len(parts) < 3:
        return None, None
    return f"{parts[0]}/{parts[1]}", (parts[2] if len(parts) > 3 else None)


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
    the one the frame loaded, so it works whoever asked for the reload.

    state: starting (until the app answers on its port) → ready; stopped if
    the command exits (the log says why); off with no command."""

    ERROR = re.compile(r"\berror\b|Failed to compile|SyntaxError|Cannot find module|Could not resolve", re.I)

    def __init__(self, port):
        app = CONFIG.get("app", {})
        self.port = port
        self.host = app.get("host", "127.0.0.1")
        self.path = app.get("path", "/")
        self.cmd = app.get("command")
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
            time.sleep(settle)  # the dev server sees the files change on its own
            with self.cv:
                lines = list(self.log)[-(self.count - mark):] if self.count > mark else []
            errors = [l for l in lines if self.ERROR.search(l)][:40]
            if errors:
                result = {"ok": False, "message": "The dev server reported errors: the app may still run the code from before.", "errors": errors}
            else:
                result = {"ok": True, "message": "Reloaded: the app runs the change." if not restart else "The app started again.", "errors": []}
            result["frame"] = "reload" if restart else None
            result["at"] = time.strftime("%H:%M:%S")
            self.last = result
            return result

    def stop(self):
        if self.proc and self.proc.poll() is None:
            try:
                os.killpg(self.proc.pid, signal.SIGTERM)
                self.proc.wait(5)
            except (OSError, subprocess.TimeoutExpired):
                pass


def make_app(port):
    return FlutterApp(port) if ADAPTER == "flutter" else CommandApp(port)


def made_by(text):
    """[(exploration, version)] that a run of new.py or duplicate.py says it made:
    "Started <screen>/<exploration> in …" (its default) or "Made <screen>/<exploration>
    <version> from …"."""
    out = [(pg, "default") for pg in re.findall(r"Started ([a-z0-9-]+/[a-z0-9-]+) in ", text)]
    out += re.findall(r"Made ([a-z0-9-]+/[a-z0-9-]+) ([a-z0-9]+) from ", text)
    return out


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

    def command(self, prompt, session):
        cmd = [
            self.claude, "-p", prompt,
            "--output-format", "stream-json", "--verbose",
            "--setting-sources", "project",
            "--strict-mcp-config",
            "--permission-mode", "dontAsk",
            "--permission-prompts", "none",
            "--tools", "Read,Glob,Grep,Edit,Write,Bash",
            "--allowedTools", "Read(./**)", f"Edit({DATA_REL}/**)", f"Write({DATA_REL}/**)", "Edit(playground/notes/**)",
            "Bash(python3 playground/duplicate.py:*)", "Bash(python3 playground/new.py:*)",
            "Bash(python3 playground/reload.py:*)",
            "--append-system-prompt", chat_rules(),
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
        context = []
        if body.get("screen"):
            shown = f"The app is showing the \"{body['screen']}\" page"
            if body.get("screenTitle"):
                shown += f" ({body['screenTitle']}"
                if isinstance(body.get("params"), dict) and body["params"]:
                    shown += ", " + ", ".join(f"{k} {v}" for k, v in body["params"].items())
                shown += ")"
            if isinstance(body.get("files"), list) and body["files"]:
                shown += ", drawn from " + " with ".join(str(f) for f in body["files"][:4])
            context.append(shown + ".")
        if body.get("folder"):
            context.append(f"The Explorations panel has the \"{body['folder']}\" screen's folder open.")
        if body.get("playground"):
            context.append(
                f"The exploration on show is \"{body['playground']}\", "
                f"version \"{body.get('version') or 'default'}\" ({body.get('versionState') or 'shown'})."
            )
        prompt = message + ("\n\n(" + " ".join(context) + ")" if context else "")
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
        mine = set()  # (exploration, version) this run made: other tabs' runs make versions too
        tools = {}
        errors = tempfile.TemporaryFile("w+")
        flutter = find_flutter() if ADAPTER == "flutter" else None
        env = dict(os.environ, PLAYGROUND_PORT=str(Handler.port))  # for reload.py
        if flutter:
            env["PATH"] = f"{Path(flutter).parent}:{env.get('PATH', '')}"
        try:
            proc = subprocess.Popen(
                self.command(prompt, body.get("session")), cwd=ROOT, env=env,
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
                        emit({"type": "changed", "playground": pg, "version": version, "new": new_ones(known_versions()), "reloaded": reloaded})
            elif kind == "result":
                new = new_ones(known_versions())
                emit({
                    "type": "done", "ok": not event.get("is_error"), "session": event.get("session_id"),
                    "summary": event.get("result") or "", "new": new, "cost": event.get("total_cost_usd"),
                    "refused": len(event.get("permission_denials") or []),
                })
                done = True
        proc.wait()
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


class Handler(SimpleHTTPRequestHandler):
    chat = None  # a Chat, or None with --no-chat
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

    def do_GET(self):
        path, _, query = self.path.partition("?")
        if path == "/":
            self.send_response(302)  # keeping ?playground=…&v=…, which opens on a version
            self.send_header("Location", "/playground/" + (f"?{query}" if query else ""))
            self.end_headers()
            return
        if path == "/playground/chat":
            why = "off" if self.chat is None else None if self.chat.ready() else "missing"
            self.json(200, {"enabled": why is None, "why": why, "folder": str(ROOT), "notes": True, "tabs": MAX_RUNS})
            return
        if path == "/playground/app":
            self.json(200, self.app.status())
            return
        super().do_GET()

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
            self.send_error(400, f"Picks must name an exploration in {DATA_REL}/index.json and one of its versions")
            return
        write_json(PICKS, dict(sorted(picks.items())))
        self.log_message("Saved playground picks: %s", ", ".join(f"{pg} {v}" for pg, v in sorted(picks.items())) or "none")
        self.send_response(204)
        self.end_headers()

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
    clear_old_attachments()
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
        Handler.app.stop()


if __name__ == "__main__":
    main()
