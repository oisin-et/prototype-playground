"""Frozen copies of versions, for the canvas (canvas.html, src/canvas.js).

A version on its own is only its changes, laid over main when it's opened. Main
moves on, so an old version shows on today's main, and can look different
from the day it was made, or break. A frozen copy keeps it on the main it was
made on: its base never changes.

The rules (the canvas's foundation):

- A frame is one exploration, and its base is fixed when the exploration
  starts: main as it is then. Every iteration made from it (iterate.py, or
  new.py --from) takes the same base, so a frame's iterations always run on
  the main they were written for, like the commits of one branch.
- A version is frozen the moment it's made: new.py and iterate.py call
  freeze() as they make it. sync() freezes anything made some other way.
- A frozen copy runs its base with its own version on top, and nothing else:
  its registry lists that one version, and the version's own folder is read
  from disk, so what Claude made in it is always what the frame shows. (On the
  canvas, a version doesn't change after the message that made it: a change is
  a new iteration. See serve.py's CANVAS_RULES.)

Only for an app that is served as its own files, with no build step
("canvas": {"freeze": {"kind": "files"}} in playground.json, web adapter). The
copy takes no room for what git has already:

- commit: main's commit then. Every file git has is read from it.
- dirty: the files that differed from that commit (work not committed yet, and
  files git doesn't track yet), each kept once by its content in blobs/.
- set: the playground's data folder (the versions, the bridge), which git
  ignores, kept the same way. Versions frozen together share a set.
- Anything else (a file git ignores, such as a licensed font) comes from disk.
- The bridge (the data folder's bridge.js) always comes from disk too: it's the
  playground's plumbing, not the design, so every copy talks to the playground
  as it is now (a new message, such as X-ray's, works on old copies too).

A version that was never frozen (made before this, or by hand) is frozen by
sync(): from its "from" version's base when that one is frozen; one made
today, on main as it is now ("frozen"); an older one, on main's last commit of
its date ("rebuilt"), or today's main when git has nothing that old ("today").

Each frozen copy the canvas opens is served on a port of its own (open_copy()),
so an app that names its files from the root (/src/…) works as it is. A few
stay open; the one used longest ago is closed first.

Everything is kept in playground/frozen/ (git ignores it). Standard library only.
"""
import datetime
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

from pglib import ADAPTER, CONFIG, DATA, HERE, ROOT, VERSION_FILE, playgrounds, read_json, versions

FROZEN = HERE / "frozen"
BLOBS = FROZEN / "blobs"
SETS = FROZEN / "sets"
MANIFESTS = FROZEN / "versions"
HASHES = FROZEN / "hashes.json"
SETTINGS = CONFIG.get("canvas", {}).get("freeze")
APP_PATH = CONFIG.get("app", {}).get("path", "/")
KEY = re.compile(r"^[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)*/v\d+\.\d+$")
POOL_MAX = 6
DATA_REL = DATA.relative_to(ROOT).as_posix()
LIVE = {f"{DATA_REL}/bridge.js"}  # served from disk in every copy
REGISTRY_REL = f"{DATA_REL}/registry.js"  # each copy has its own: its one version
UNTRACKED_MAX = 400  # files git doesn't track yet, kept with a copy (more: read from disk)

TYPES = {".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css",
         ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".otf": "font/otf",
         ".ttf": "font/ttf", ".wasm": "application/wasm", ".html": "text/html; charset=utf-8"}


def enabled():
    return isinstance(SETTINGS, dict) and SETTINGS.get("kind") == "files" and ADAPTER == "web"


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
    """The files that differ from HEAD now, kept: {path: blob}. Those git has
    that changed, and those it doesn't track yet (and doesn't ignore), outside
    the data folder (that's the set)."""
    out = {}
    changed = git("diff", "--name-only", "-z", "HEAD").split("\0")
    untracked = git("ls-files", "--others", "--exclude-standard", "-z").split("\0")[:UNTRACKED_MAX]
    for rel in filter(None, changed + untracked):
        p = ROOT / rel
        if p.is_file() and not rel.startswith(f"{DATA_REL}/"):
            out[rel] = file_sha(p)
    return out


# ---- Freezing ---------------------------------------------------------------------
def manifest_path(key):
    return MANIFESTS / f"{key}.json"


def manifest(key):
    return read_json(manifest_path(key), None) if KEY.match(str(key or "")) else None


def base_now(cache=None):
    """Main as it is now: (commit, dirty, set)."""
    cache = {} if cache is None else cache
    if "now" not in cache:
        cache["now"] = (git("rev-parse", "HEAD"), dirty_files(), data_set())
    return cache["now"]


def freeze(key, source=None, date=None, cache=None):
    """Freezes the version key (<screen>/v<N>.<M>), unless it is already.
    source: the version it was copied from (an id in the same screen), whose
    base it takes when that one is frozen; otherwise main as it is now."""
    if not enabled() or not KEY.match(key) or manifest_path(key).exists():
        return None
    pg = key.rsplit("/", 1)[0]
    parent = manifest(f"{pg}/{source}") if source and re.match(r"^v\d+\.\d+$", str(source)) else None
    if parent:
        commit, dirty, sid = parent["commit"], parent.get("dirty", {}), parent["set"]
        label, base = parent["label"], parent.get("base") or parent.get("made")
    else:
        commit, dirty, sid = base_now(cache)
        label, base = "frozen", None
    made = datetime.datetime.now().isoformat(timespec="seconds")
    m = {"key": key, "label": label, "commit": commit, "dirty": dirty, "set": sid,
         "date": date or datetime.date.today().isoformat(), "made": made, "base": base or made,
         "from": parent["key"] if parent else None}
    write(manifest_path(key), m)
    save_hashes()
    return m


def sync():
    """Freezes every version that isn't yet (made some other way than new.py
    and iterate.py, or before they froze). Returns listing()."""
    if not enabled():
        return {}
    today = datetime.date.today().isoformat()
    cache = {}
    for pg in playgrounds():
        vs = versions(pg)
        # Sources first, so an iteration can take its source's base.
        order = sorted(vs, key=lambda v: [int(n) for n in re.findall(r"\d+", str(v.get("id", "")))])
        for v in order:
            vid = v.get("id", "")
            key = f"{pg}/{vid}"
            if not re.match(r"^v\d+\.\d+$", vid) or manifest_path(key).exists():
                continue
            date = str(v.get("date", ""))
            if v.get("from") and manifest(f"{pg}/{v['from']}"):
                freeze(key, v["from"], date, cache)
            elif date >= today or not date:
                freeze(key, None, date or today, cache)
            else:
                commit = git("rev-list", "-1", f"--before={date} 23:59:59", "HEAD")
                write(manifest_path(key), {
                    "key": key, "label": "rebuilt" if commit else "today", "commit": commit or base_now(cache)[0],
                    "dirty": {}, "set": base_now(cache)[2], "date": date,
                    "made": datetime.datetime.now().isoformat(timespec="seconds"), "base": f"{date}T23:59:59" if commit else None,
                })
    save_hashes()
    return listing()


def base_drift(key, limit=15):
    """How main has moved on since key's base: (when the base was taken, the
    files that differ now, outside the data folder), or None."""
    m = manifest(key)
    if not m:
        return None
    files = set(filter(None, git("diff", "--name-only", "-z", m["commit"]).split("\0")))
    files |= set(filter(None, git("ls-files", "--others", "--exclude-standard", "-z").split("\0")[:UNTRACKED_MAX]))
    out = []
    for rel in sorted(files):
        if rel.startswith(f"{DATA_REL}/") or not (ROOT / rel).is_file():
            continue
        kept = m.get("dirty", {}).get(rel)
        if kept and file_sha(ROOT / rel) == kept:
            continue  # it differed from the commit then too, and hasn't changed since
        out.append(rel)
    for rel, kept in m.get("dirty", {}).items():
        if rel not in files and rel not in out:
            out.append(rel)  # differed then, back to the commit's now
    save_hashes()
    return {"base": m.get("base") or m.get("made"), "commit": m["commit"][:7], "files": out[:limit], "count": len(out)}


def listing():
    out = {}
    if MANIFESTS.exists():
        for p in MANIFESTS.rglob("*.json"):
            m = read_json(p, {})
            if m.get("key"):
                out[m["key"]] = {"label": m["label"], "commit": m["commit"][:7], "date": m.get("date"),
                                 "made": m.get("made"), "base": m.get("base") or m.get("made"), "from": m.get("from")}
    return out


# ---- Serving a frozen copy ---------------------------------------------------------
class Snapshot:
    def __init__(self, key):
        m = read_json(manifest_path(key))
        self.key = key
        self.commit = m["commit"]
        self.files = {**read_json(SETS / f"{m['set']}.json", {}), **m.get("dirty", {})}
        self.own = f"{DATA_REL}/{key}/"  # the version's own folder: from disk
        # Its registry: this one version, and nothing else.
        self.registry = "\n".join([
            "// The registry of a frozen copy (playground/frozen.py): its one version.",
            "const load = (id, get) => get().then(",
            "  (m) => [id, m.default ?? m.version],",
            "  (e) => [id, null, `${id}: ${e?.message || e}`],",
            ");",
            f"const loaded = await Promise.all([load('{key}', () => import('./{key}/{VERSION_FILE}'))]);",
            "export default Object.fromEntries(loaded.filter(([, v]) => v).map(([id, v]) => [id, v]));",
            "export const errors = loaded.filter(([, , e]) => e).map(([, , e]) => e);",
            "",
        ]).encode()

    def get(self, rel):
        """(etag, bytes) or None."""
        if rel == REGISTRY_REL:
            return hashlib.sha1(self.registry).hexdigest(), self.registry
        if (rel in LIVE or rel.startswith(self.own)) and (ROOT / rel).is_file():
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
