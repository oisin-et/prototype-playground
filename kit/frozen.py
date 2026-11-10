"""Frozen copies of versions, for the canvas (canvas.html, src/canvas.js).

A version on its own is only its changes, laid over main when it's opened. Main
moves on, so an old version shows on today's main, and can look different
from the day it was made, or break. A frozen copy keeps it as it was: the
app's files as they were then, with the version on top, and it never changes.

Only for an app that is served as its own files, with no build step
("canvas": {"freeze": {"kind": "files"}} in playground.json). The copy takes
no room for what git has already:

- commit: main's commit then. Every file git has is read from it.
- dirty: the files that differed from that commit when it was frozen (an app
  with work not committed yet), each kept once by its content in blobs/.
- set: the playground's data folder (the versions, the registry, the bridge),
  which git ignores, kept the same way. Versions frozen together share a set.
- Anything else (a file git ignores, such as a licensed font) comes from disk.
- The bridge (the data folder's bridge.js) always comes from disk too: it's the
  playground's plumbing, not the design, so every copy talks to the playground
  as it is now (a new message, such as X-ray's, works on old copies too).

A version is frozen the first time the canvas sees it (sync()):

- One made today: from the app as it is now, labelled "frozen". Not while a
  chat holds the lock or its folder changed in the last 5 minutes (still
  being made): the next sync gets it.
- An older one, which was never frozen: rebuilt on main's last commit of its
  date, labelled "rebuilt". If git has no commit that old, on today's main,
  labelled "today".

Each frozen copy the canvas opens is served on a port of its own (open()), so
an app that names its files from the root (/src/…) works as it is. A few stay
open; the one used longest ago is closed first.

Everything is kept in playground/frozen/ (git ignores it). Standard library only.
"""
import datetime
import fcntl
import hashlib
import json
import mimetypes
import re
import subprocess
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from pglib import CONFIG, DATA, HERE, ROOT, playgrounds, read_json, versions

FROZEN = HERE / "frozen"
BLOBS = FROZEN / "blobs"
SETS = FROZEN / "sets"
MANIFESTS = FROZEN / "versions"
HASHES = FROZEN / "hashes.json"
SETTINGS = CONFIG.get("canvas", {}).get("freeze")
APP_PATH = CONFIG.get("app", {}).get("path", "/")
KEY = re.compile(r"^[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)*/v\d+\.\d+$")
POOL_MAX = 6
LIVE = {(DATA / "bridge.js").relative_to(ROOT).as_posix()}  # served from disk in every copy
STILL_MAKING = 300  # seconds: a version folder changed more recently is still being made

TYPES = {".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css",
         ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".otf": "font/otf",
         ".ttf": "font/ttf", ".wasm": "application/wasm", ".html": "text/html; charset=utf-8"}


def enabled():
    return isinstance(SETTINGS, dict) and SETTINGS.get("kind") == "files"


def git(*args):
    r = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else ""


class GitFiles:
    """Reads files from git's own store (one `git cat-file --batch` kept open)."""

    def __init__(self):
        self.proc = None
        self.lock = threading.Lock()

    def read(self, commit, path):
        """(sha, bytes) of path at commit, or None when git doesn't have it."""
        with self.lock:
            if self.proc is None or self.proc.poll() is not None:
                self.proc = subprocess.Popen(["git", "cat-file", "--batch"], cwd=ROOT,
                                             stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            self.proc.stdin.write(f"{commit}:{path}\n".encode())
            self.proc.stdin.flush()
            head = self.proc.stdout.readline().decode().split()
            if len(head) != 3 or head[1] != "blob":
                return None
            data = self.proc.stdout.read(int(head[2]))
            self.proc.stdout.read(1)
            return head[0], data


GIT = GitFiles()


# ---- Blobs: each file kept once, by its content --------------------------------
def blob_path(sha):
    return BLOBS / sha[:2] / sha[2:]


def put_blob(data):
    sha = hashlib.sha1(data).hexdigest()
    p = blob_path(sha)
    if not p.exists():
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".tmp")
        tmp.write_bytes(data)
        tmp.replace(p)
    return sha


_hashes = None


def file_sha(path):
    """The blob of a file on disk, kept, with what it was by size and time so an
    unchanged file isn't read again."""
    global _hashes
    if _hashes is None:
        _hashes = read_json(HASHES, {})
    st = path.stat()
    rel = str(path.relative_to(ROOT))
    seen = _hashes.get(rel)
    if seen and seen[0] == st.st_mtime_ns and seen[1] == st.st_size and blob_path(seen[2]).exists():
        return seen[2]
    sha = put_blob(path.read_bytes())
    _hashes[rel] = [st.st_mtime_ns, st.st_size, sha]
    return sha


def save_hashes():
    if _hashes is not None:
        write(HASHES, _hashes)


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(value, indent=1))
    tmp.replace(path)


def data_set():
    """The data folder now, kept: its id."""
    files = {}
    for p in sorted(DATA.rglob("*")):
        if p.is_file() and p.name not in (".lock", ".DS_Store") and "__pycache__" not in p.parts:
            files[str(p.relative_to(ROOT))] = file_sha(p)
    sid = hashlib.sha1(json.dumps(files, sort_keys=True).encode()).hexdigest()[:16]
    if not (SETS / f"{sid}.json").exists():
        write(SETS / f"{sid}.json", files)
    return sid


def dirty_files():
    """The files git has that differ from HEAD now, kept: {path: blob}."""
    out = {}
    for rel in filter(None, git("diff", "--name-only", "-z", "HEAD").split("\0")):
        p = ROOT / rel
        if p.is_file():
            out[rel] = file_sha(p)
    return out


# ---- Freezing ---------------------------------------------------------------------
def chat_busy():
    """Whether a chat holds the playground's lock (pglib.playground_lock) now."""
    try:
        with open(DATA / ".lock", "a") as f:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
            fcntl.flock(f, fcntl.LOCK_UN)
        return False
    except BlockingIOError:
        return True
    except OSError:
        return False


def manifest_path(key):
    return MANIFESTS / f"{key}.json"


def newest_change(folder):
    try:
        return max((p.stat().st_mtime for p in folder.rglob("*")), default=folder.stat().st_mtime)
    except OSError:
        return 0


def sync(stale=None):
    """Freezes every version that isn't yet. Returns listing(). stale: versions
    a chat changed after they were frozen today; they're frozen again, once
    they settle."""
    if not enabled():
        return {}
    for key in stale or []:
        p = manifest_path(str(key))
        if KEY.match(str(key)) and p.exists() and read_json(p, {}).get("label") == "frozen":
            p.unlink()
    today = datetime.date.today().isoformat()
    head = git("rev-parse", "HEAD")
    busy = chat_busy()
    cache = {}
    for pg in playgrounds():
        for v in versions(pg):
            vid = v.get("id", "")
            if not re.match(r"^v\d+\.\d+$", vid):
                continue
            key = f"{pg}/{vid}"
            if manifest_path(key).exists():
                continue
            date = str(v.get("date", ""))
            made_today = date >= today
            if made_today and (busy or time.time() - newest_change(DATA / pg / vid) < STILL_MAKING):
                continue  # still being made: the next sync freezes it
            if made_today:
                commit, label = head, "frozen"
                if "dirty" not in cache:
                    cache["dirty"] = dirty_files()
                dirty = cache["dirty"]
            else:
                commit = git("rev-list", "-1", f"--before={date} 23:59:59", "HEAD") if date else ""
                label = "rebuilt" if commit else "today"
                commit, dirty = commit or head, {}
            if "set" not in cache:
                cache["set"] = data_set()
            write(manifest_path(key), {
                "key": key, "label": label, "commit": commit, "dirty": dirty, "set": cache["set"],
                "date": date, "made": datetime.datetime.now().isoformat(timespec="seconds"),
            })
    save_hashes()
    return listing()


def listing():
    out = {}
    if MANIFESTS.exists():
        for p in MANIFESTS.rglob("*.json"):
            m = read_json(p, {})
            if m.get("key"):
                out[m["key"]] = {"label": m["label"], "commit": m["commit"][:7], "date": m.get("date"), "made": m.get("made")}
    return out


# ---- Serving a frozen copy ---------------------------------------------------------
class Snapshot:
    def __init__(self, key):
        m = read_json(manifest_path(key))
        self.commit = m["commit"]
        self.files = {**read_json(SETS / f"{m['set']}.json", {}), **m.get("dirty", {})}

    def get(self, rel):
        """(etag, bytes) or None."""
        if rel in LIVE and (ROOT / rel).is_file():
            st = (ROOT / rel).stat()
            return f"{st.st_mtime_ns}-{st.st_size}", (ROOT / rel).read_bytes()
        sha = self.files.get(rel)
        if sha and blob_path(sha).exists():
            return sha, blob_path(sha).read_bytes()
        found = GIT.read(self.commit, rel)
        if found:
            return found
        p = (ROOT / rel).resolve()
        if p.is_file() and ROOT.resolve() in p.parents and ".git" not in p.relative_to(ROOT.resolve()).parts:
            st = p.stat()
            return f"{st.st_mtime_ns}-{st.st_size}", p.read_bytes()
        return None


def handler_for(snapshot):
    class FrozenHandler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            path = urllib.parse.unquote(self.path.split("?")[0].split("#")[0])
            if path.endswith("/"):
                path += "index.html"
            rel = path.lstrip("/")
            if not rel or ".." in rel.split("/"):
                self.send_error(404)
                return
            found = snapshot.get(rel)
            if not found:
                self.send_error(404)
                return
            etag, data = found
            if self.headers.get("If-None-Match") == f'"{etag}"':
                self.send_response(304)
                self.end_headers()
                return
            suffix = Path(rel).suffix.lower()
            self.send_response(200)
            self.send_header("Content-Type", TYPES.get(suffix) or mimetypes.guess_type(rel)[0] or "application/octet-stream")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-cache")
            self.send_header("ETag", f'"{etag}"')
            self.end_headers()
            self.wfile.write(data)

    return FrozenHandler


_pool = {}  # key → [server, port, last used]
_pool_lock = threading.Lock()


def open_copy(key):
    """Serves the frozen copy of key on a port of its own; returns the port."""
    if not enabled() or not KEY.match(key or "") or not manifest_path(key).exists():
        return None
    with _pool_lock:
        if key in _pool:
            _pool[key][2] = time.time()
            return _pool[key][1]
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler_for(Snapshot(key)))
        server.daemon_threads = True
        threading.Thread(target=server.serve_forever, daemon=True).start()
        _pool[key] = [server, server.server_address[1], time.time()]
        while len(_pool) > POOL_MAX:
            old = min(_pool, key=lambda k: _pool[k][2])
            s = _pool.pop(old)[0]
            threading.Thread(target=lambda s=s: (s.shutdown(), s.server_close()), daemon=True).start()
        return _pool[key][1]
