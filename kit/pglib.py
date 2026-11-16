"""What serve.py, new.py, iterate.py and reload.py share: the project's
playground config (playground/playground.json), where things are, and the
registry of versions the app compiles in, and making a version.

Part of the prototype-playground kit: the same in every project, so don't
change it here; change playground.json, or the kit and copy it again
(scripts/setup.py --update in the skill). Standard library only.
"""

import contextlib
import fcntl
import json
import os
import re
import shutil
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent  # the project's playground/
ROOT = HERE.parent  # the project
CONFIG = json.loads((HERE / "playground.json").read_text())

ADAPTER = CONFIG.get("adapter", "web")  # "flutter" or "web"
DATA = ROOT / CONFIG["data"]  # the explorations, index.json, picks.json, screens.json
INDEX = DATA / "index.json"
PICKS = DATA / "picks.json"
SCREENS = DATA / "screens.json"
# The canvas's own (canvas.html): which explorations it shows. The data folder
# is the classic playground's too; the canvas shows only its own explorations.
CANVAS = HERE / "canvas.json"
# A screen's explorations go across and their iterations down: v4.0 is
# exploration 4, and v4.1, v4.2 … are its iterations, each from the one before
# (or whichever it says in "from"). "default" is main, the app as it is.
VERSION_ID = re.compile(r"^v(\d+)\.(\d+)$")

if ADAPTER == "flutter":
    PACKAGE = CONFIG.get("flutter", {}).get("package", "")
    LIB = ROOT / "lib"
    VERSION_FILE = "version.dart"
    REGISTRY = DATA / "registry.g.dart"
else:
    VERSION_FILE = CONFIG.get("web", {}).get("versionFile", "version.js")
    REGISTRY = DATA / CONFIG.get("web", {}).get("registry", "registry.js")


def rel(path):
    """path from the project's top, as text."""
    return Path(path).resolve().relative_to(ROOT.resolve()).as_posix()


@contextlib.contextmanager
def playground_lock():
    """Held while index.json, a versions.json or the registry is read and written
    back, so two chats making versions at once can't overwrite each other's entries."""
    DATA.mkdir(parents=True, exist_ok=True)
    with open(DATA / ".lock", "w") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)


def read_json(path, fallback=None):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        if fallback is None:
            raise
        return fallback


def write_json(path, value):
    """Writes JSON indented, but with short arrays and objects (up to 100
    characters) kept on one line."""
    def fmt(v, indent):
        flat = json.dumps(v, ensure_ascii=False)
        if not isinstance(v, (dict, list)) or len(flat) + indent <= 100:
            return flat
        pad, inner = " " * indent, " " * (indent + 2)
        if isinstance(v, dict):
            items = [f'{inner}{json.dumps(k, ensure_ascii=False)}: {fmt(x, indent + 2)}' for k, x in v.items()]
            return "{\n" + ",\n".join(items) + f"\n{pad}}}"
        return "[\n" + ",\n".join(inner + fmt(x, indent + 2) for x in v) + f"\n{pad}]"
    Path(path).write_text(fmt(value, 0) + "\n")


def screens():
    return read_json(SCREENS)["screens"]


def playgrounds():
    return read_json(INDEX, {"playgrounds": []}).get("playgrounds", [])


def on_canvas():
    """The explorations on the canvas (<screen>/v<N>), in the order they
    joined it. Main is always there, and isn't listed."""
    return [f["id"] for f in read_json(CANVAS, {}).get("frames", []) if isinstance(f, dict) and f.get("id")]


BOARDS = DATA / "boards"
BOARD_KINDS = ("variants", "flow", "states", "review")


def read_board(board_id):
    """A starting prompt's board (<data>/boards/<id>.json), or None if it isn't
    there or isn't one: a kind the canvas knows and at least one item."""
    try:
        doc = read_json(BOARDS / f"{board_id}.json")
    except (OSError, ValueError):
        return None
    if not isinstance(doc, dict) or doc.get("kind") not in BOARD_KINDS:
        return None
    items = doc.get("items")
    return doc if isinstance(items, list) and items and all(isinstance(x, dict) for x in items) else None


def add_boards(ids):
    """Puts the boards a run wrote on the canvas, after the ones there. Returns
    the ids that joined: a board that's missing or malformed doesn't."""
    doc = read_json(CANVAS, {})
    boards = doc.get("boards", [])
    have = {b.get("id") for b in boards if isinstance(b, dict)}
    joined = [i for i in ids if i and i not in have and read_board(i)]
    if joined:
        stamp = time.strftime("%Y-%m-%dT%H:%M:%S")
        write_json(CANVAS, {**doc, "boards": boards + [{"id": i, "added": stamp} for i in joined]})
    return joined


def board_explorations(ids):
    """The explorations (<screen>/v<N>) that the boards show as their own: a
    board's variants, and the exploration a flow or states board made for its
    states. They stay off the row of frames, on their board. A review's After
    isn't one of them: it's the next step of the exploration it fixes."""
    out = set()
    for i in ids:
        doc = read_board(i)
        if not doc or doc["kind"] == "review":
            continue
        for item in doc["items"] + [c for x in doc["items"] for c in (x.get("cases") or []) if isinstance(c, dict)]:
            ref = str(item.get("version") or "")
            pg, _, vid = ref.rpartition("/")
            n = number(vid)
            if pg and n:
                out.add(f"{pg}/v{n[0]}")
    return out


def add_to_canvas(made, skip=()):
    """Puts the explorations of versions made from the canvas on it: made is
    [(screen, version id)]; skip, explorations a board shows instead. Returns
    the explorations that joined."""
    doc = read_json(CANVAS, {})
    frames = doc.get("frames", [])
    have = {f.get("id") for f in frames if isinstance(f, dict)} | set(skip)
    joined = []
    for pg, vid in made:
        n = number(vid)
        key = f"{pg}/v{n[0]}" if n else None
        if key and key not in have:
            have.add(key)
            joined.append(key)
            frames.append({"id": key, "added": time.strftime("%Y-%m-%dT%H:%M:%S")})
    if joined:
        write_json(CANVAS, {**doc, "frames": frames})
    return joined


def number(vid):
    """(exploration, iteration) for an id like v4.2, or None (main, or an id
    from before the numbering)."""
    m = VERSION_ID.match(vid or "")
    return (int(m[1]), int(m[2])) if m else None


def versions(pg):
    return read_json(DATA / pg / "versions.json", {"versions": []}).get("versions", [])


def known_versions():
    """{screen: [version ids]} for every screen in index.json."""
    return {pg: [v["id"] for v in versions(pg)] for pg in playgrounds()}


def built_versions():
    """Every version folder with a version file, by id (<screen>/<version>)."""
    ids = []
    for pg in playgrounds():
        for v in versions(pg):
            if v["id"] != "default" and (DATA / pg / v["id"] / VERSION_FILE).is_file():
                ids.append(f"{pg}/{v['id']}")
    return ids


def write_registry():
    """Writes the registry, the list of versions the app compiles in, if it
    changed. Returns True when it did (a new or removed version)."""
    ids = built_versions()
    alias = lambda i: "v_" + re.sub(r"[^A-Za-z0-9]", "_", i)  # a Dart import prefix
    if ADAPTER == "flutter":
        # A function, not a final, so a hot reload sees a new version (Dart
        # keeps a final's first value across reloads).
        lines = [
            "// GENERATED by playground/pglib.py (serve.py, new.py and iterate.py run it).",
            "// The playground's versions, by id. Don't edit.",
            "",
            "import 'version_api.dart';",
            *[f"import '{i}/{VERSION_FILE}' as {alias(i)};" for i in ids],
            "",
            "Map<String, PlaygroundVersion> playgroundVersions() => {",
            *[f"  '{i}': {alias(i)}.version," for i in ids],
            "};",
            "",
        ]
    else:
        # Each version is loaded on its own, so one that doesn't load (a
        # syntax error, a missing file) is left out and named in `errors`, and
        # the app and the other versions still run.
        lines = [
            "// GENERATED by playground/pglib.py (serve.py, new.py and iterate.py run it).",
            "// The playground's versions, by id. Don't edit. Each is loaded on its own: one",
            "// that doesn't load is left out, and named in `errors`.",
            "",
            "const load = (id, get) => get().then(",
            "  (m) => [id, m.default ?? m.version],",
            "  (e) => [id, null, `${id}: ${e?.message || e}`],",
            ");",
            "const loaded = await Promise.all([",
            *[f"  load('{i}', () => import('./{i}/{VERSION_FILE}'))," for i in ids],
            "]);",
            "",
            "export default Object.fromEntries(loaded.filter(([, v]) => v).map(([id, v]) => [id, v]));",
            "export const errors = loaded.filter(([, , e]) => e).map(([, , e]) => e);",
            "",
        ]
    text = "\n".join(lines)
    if REGISTRY.is_file() and REGISTRY.read_text() == text:
        return False
    REGISTRY.write_text(text)
    return True


# ---- Copying a page into a version ------------------------------------------------
# duplicate.py copies the app's own file for a screen into a new version. Its
# imports must still work from there: Dart's become package: ones, the web's
# relative ones are pointed back at the files they named.

DART_IMPORT = re.compile(r"""^(\s*(?:import|export|part)\s+)(['"])([^'"]+)\2""", re.M)
JS_IMPORT = re.compile(r"""(\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+|\bexport\s+\*\s+from\s*)(['"])(\.{1,2}/[^'"]+)\2""", re.M)


def relocated(source, from_file, to_dir):
    """The source of from_file, with its imports fixed to work from to_dir."""
    base = Path(from_file).resolve().parent
    if ADAPTER == "flutter":
        def fix(m):
            uri = m.group(3)
            if ":" in uri:
                return m.group(0)
            try:
                path = (base / uri).resolve().relative_to(LIB.resolve()).as_posix()
            except ValueError:
                return m.group(0)
            return f"{m.group(1)}{m.group(2)}package:{PACKAGE}/{path}{m.group(2)}"
        return DART_IMPORT.sub(fix, source)

    def fix(m):
        target = (base / m.group(3)).resolve()
        path = os.path.relpath(target, Path(to_dir).resolve())
        path = path if path.startswith(".") else "./" + path
        return f"{m.group(1)}{m.group(2)}{Path(path).as_posix()}{m.group(2)}"
    return JS_IMPORT.sub(fix, source)


# ---- Making a version ----------------------------------------------------------
# new.py starts an exploration (the next number across, vN.0) and iterate.py
# the next iteration of one (down its column, vN.M). Both copy a version, or
# the app's own file for the screen when it's "default", into the new folder.

def screen_meta(screen):
    """The screen's versions.json, started (with main) and added to index.json
    the first time. A component exploration's (component_meta started it) is
    found by its folder too."""
    existing = DATA / screen / "versions.json"
    if existing.is_file() and screen not in screens():
        return existing, read_json(existing)
    if screen not in screens():
        sys.exit(f"No screen called {screen!r}. The screens are: {', '.join(screens())}")
    path = DATA / screen / "versions.json"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        write_json(path, {
            "title": screens()[screen].get("title", screen),
            "start": screen,
            "versions": [{
                "id": "default", "name": "As it is", "date": time.strftime("%Y-%m-%d"),
                "note": f"The {screens()[screen].get('title', screen)} screen as the app has it.",
            }],
        })
        index = read_json(INDEX, {"playgrounds": []})
        if screen not in index.setdefault("playgrounds", []):
            index["playgrounds"].append(screen)
            write_json(INDEX, index)
    return path, read_json(path)


COMPONENT_PREFIX = "component-"


def component_meta(cid):
    """A component exploration's versions.json, in <data>/component-<id>/,
    started (with main) and added to index.json the first time. <id> is a
    component in the library (library.py): an entry's id, or the name of
    one drawn without an entry yet."""
    import library  # here only: it imports this module
    lib = library.library()
    item = next((x for x in lib["entries"] + lib["unlisted"] if x["id"] == cid), None)
    if not item:
        names = ", ".join(x["id"] for x in lib["entries"]) or "none"
        sys.exit(f"No component {cid!r} in the library. Its entries are: {names}; "
                 "python3 playground/library.py lists the rest.")
    pg = COMPONENT_PREFIX + cid
    path = DATA / pg / "versions.json"
    if not path.exists():
        known = [s for s in item["screens"] if s in screens()]
        path.parent.mkdir(parents=True, exist_ok=True)
        write_json(path, {
            "title": item["name"],
            "component": cid,
            "start": known[0] if known else next(iter(screens()), ""),
            "versions": [{
                "id": "default", "name": "As it is", "date": time.strftime("%Y-%m-%d"),
                "note": f"{item['name']} as the app draws it.",
            }],
        })
        index = read_json(INDEX, {"playgrounds": []})
        if pg not in index.setdefault("playgrounds", []):
            index["playgrounds"].append(pg)
            write_json(INDEX, index)
    return pg, path, read_json(path), item


def version_from_component(pg, new, name, meta, dest):
    """A component exploration's first version from main: a builder for each
    name that draws it, each leaving it as it is until it's changed."""
    import library
    item = next((x for x in (lambda l: l["entries"] + l["unlisted"])(library.library()) if x["id"] == meta["component"]), None)
    if not item:
        sys.exit(f"{meta['component']!r} isn't in the library any more.")
    template = HERE / "templates" / ("component" + Path(VERSION_FILE).suffix)
    if ADAPTER == "flutter" or not template.is_file():
        sys.exit(f"No {rel(template)}: component explorations need the web adapter's template (run the skill's setup --update).")
    parts = {m["part"] for m in item["main"]}
    # The names this app draws it by: its entry's web implementation if it
    # has one (not another platform's widget), else every name it has.
    impl = (item.get("entry") or {}).get("implementations") or {}
    web = [i.get("renderer") or i.get("part") for k, i in impl.items() if k == "web" and isinstance(i, dict)]
    names = [n for n in web if n] or item["names"]
    line = lambda n: f"    {json.dumps(n)}: (ctx) => ctx.below,\n"
    # Its look-alikes, ready to be drawn by it instead (merging them is what
    # a component exploration is often for).
    looks = "".join(f"    // {json.dumps(l['name'])}: (ctx) => ..., (a look-alike, {l['uses']} uses)\n" for l in item.get("lookalikes", []))
    dest.mkdir()
    (dest / VERSION_FILE).write_text(template.read_text().format(
        title=meta["title"], name=name or new, id=new, pg=pg,
        components="".join(line(n) for n in names if n not in parts) + looks,
        parts="".join(line(n) for n in names if n in parts),
    ))


def find_version(meta, screen, which):
    """The id for what the person or Claude calls a version: "default" or
    "main", "v4.2", "4.2", or "4" (exploration 4's own version, v4.0)."""
    ids = [v["id"] for v in meta["versions"]]
    w = str(which).strip()
    if w in ("default", "main"):
        return "default"
    for cand in (w, f"v{w}", f"v{w}.0", f"{w}.0"):
        if cand in ids:
            return cand
    sys.exit(f"{screen} has no version {which!r}. It has: main, {', '.join(i for i in ids if i != 'default')}")


def version_from_default(screen, new, name, meta, dest):
    s = screens()[screen]
    if not s.get("file"):
        sys.exit(f"The {screen} screen has no \"file\" in screens.json, so there's nothing to copy: "
                 f"start from main by writing the version's {VERSION_FILE} by hand.")
    orig = ROOT / s["file"]
    template = HERE / "templates" / VERSION_FILE
    if not template.is_file():
        sys.exit(f"No {rel(template)}: run the skill's setup again to put it back.")
    dest.mkdir()
    copy = orig.name
    # A header comment, where the file's language has // comments.
    head = f"// A copy of {s['file']} for {screen} {new}; change it freely.\n" if orig.suffix in (
        ".dart", ".js", ".jsx", ".ts", ".tsx", ".mjs") else ""
    (dest / copy).write_text(head + relocated(orig.read_text(), orig, dest))
    lib_path = Path(s["file"]).relative_to("lib").as_posix() if ADAPTER == "flutter" and s["file"].startswith("lib/") else s["file"]
    (dest / VERSION_FILE).write_text(template.read_text().format(
        title=meta["title"], name=name or new, id=new, pg=screen, screen=screen,
        package=globals().get("PACKAGE", ""), orig_path=lib_path, copy=copy, copy_stem=Path(copy).stem,
        type=s.get("type", ""), build=s.get("build", ""), export=s.get("export", "default"),
    ))


CODE = (".dart", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".vue", ".svelte", ".css")


def renamed_in(folder, pg, old, new, old_pg=None):
    """Points a copied version's own lines that name the version it came from
    (its header, paths into its folder) at the new one."""
    old_pg = old_pg or pg
    data = rel(DATA)
    for f in folder.rglob("*"):
        if not f.is_file() or f.suffix not in CODE:
            continue
        text = f.read_text()
        fixed = (text.replace(f"{old_pg} {old};", f"{pg} {new};")
                 .replace(f"{data}/{old_pg}/{old}/", f"{data}/{pg}/{new}/")
                 .replace(f"playground/{old_pg}/{old}/", f"playground/{pg}/{new}/"))
        if fixed != text:
            f.write_text(fixed)


def make_version(screen, source, new, name, meta_path, meta):
    """Copies source (a version, or "default") to the new version's folder and
    adds it to the screen's versions.json, then rewrites the registry."""
    here = DATA / screen
    dest = here / new
    if dest.exists():
        sys.exit(f"{rel(dest)} exists already.")
    if source == "default" and meta.get("component"):
        version_from_component(screen, new, name, meta, dest)
    elif source == "default":
        version_from_default(screen, new, name, meta, dest)
    else:
        shutil.copytree(here / source, dest, symlinks=True)  # a link stays a link: same depth, so it still points right
        top = dest / VERSION_FILE
        if top.exists():
            lines = top.read_text().split("\n", 1)
            if lines[0].startswith("// ") and f"({source})." in lines[0]:
                lines[0] = f"// {meta['title']}: {name or new} ({new})." + lines[0].split(f"({source}).", 1)[1]
                top.write_text("\n".join(lines))
        renamed_in(dest, screen, source, new)
    entry = {"id": new, "name": name or new, "date": time.strftime("%Y-%m-%d"), "note": ""}
    if source != "default":
        entry["from"] = source
    meta["versions"].append(entry)
    write_json(meta_path, meta)
    write_registry()
    # The canvas's frozen copy (frozen.py): the version's base is fixed now, as
    # it's made: main as it is, or, made from a version, that version's base.
    try:
        import frozen
        frozen.freeze(f"{screen}/{new}", None if source == "default" else source)
    except Exception as e:  # the version is made: a copy that failed is made by the next sync
        print(f"(The canvas's frozen copy of {screen} {new} wasn't made: {e})")
    print(f"Made {screen} {new} from {source}: {rel(dest)}/. Write what it changes in its note in versions.json.")
