"""The project's component library: what each component is, and everywhere
the app uses it.

    python3 playground/library.py           # the library, as a table
    python3 playground/library.py --json    # the same as JSON, for the playground
    python3 playground/library.py --brief   # what to design with, short (for Claude)
    python3 playground/library.py --check <screen> <version>   # a version against it

A component's entry is a JSON file in the library folder ("library" in
playground.json, "dir": "library" by default): its name, status, purpose,
axes, behaviour, lineage and the code that draws it on each platform
("implementations"). The uses aren't written down anywhere: they're found by
scanning the app's files every time, so they can't go out of date.

A scan finds four kinds of use:

- instance: a node that names the component, or places a shared part.
- override: a screen's own copy of a shared part, placed instead of it.
- copy: a tree that has most of a shared part's node ids but doesn't place
  it, so a change to the part doesn't reach it.
- look-alike: something drawn by a name that matches an entry's "lookalikes"
  patterns but isn't one of its implementations.

An override or a copy that holds different components from the part it came
from says what differs. Each component also gets specimens to draw in the
Library: up to SPECIMENS of the different ways the app sets it up (its props,
or a part's "with", and its size), and the named "states" its entry lists
(each {"name", "props", "size": [w, h]}). Raw colours (hex or rgb() where a token should be)
are counted by file.

playground.json says where to look and how:

    "library": {
      "dir": "library",
      "primitives": ["Rect", "Text"],          # basic parts, counted but not listed
      "scan": [
        {"kind": "json", "files": ["data/screens/*.json"],      # node trees
         "parts": ["data/fragments.json"],                       # shared parts by name
         "keys": {"component": "component", "use": "use", "own": "fragments"}},
        {"kind": "code", "files": ["src/**/*.js"],               # source, by pattern
         "pattern": "component: ?['\\"](?P<name>\\\\w+)['\\"]"}
      ]
    }

A version can propose a new component: its entry, in the version's own
library/ folder (<data>/<screen>/<version>/library/<id>.json, "status":
"proposed"). The Library lists proposals apart, and Commit moves a picked
version's into the library folder as drafts.

--check compares a version with main (the app's own file for its screen, or
nothing for a component exploration) and says what it brings in that's out of
step with the library: a component with no entry or proposal, a look-alike
of an entry, a colour that isn't a token (and isn't in main already), and a
copy of a shared part instead of the part. "define" in "library" says where
the app's code defines its renderers, {"files": [...], "patterns": [...]}
(each pattern names one as (?P<name>…)), so one the app has but no screen
places isn't taken for new, and one a version defines counts too.

Part of the prototype-playground kit: the same in every project, so don't
change it here; change playground.json, or the kit and copy it again
(scripts/setup.py --update in the skill). Standard library only.
"""

import fnmatch
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

from pglib import CONFIG, HERE, ROOT, SCREENS, read_json, rel

LIB = CONFIG.get("library") or {}
DIR = ROOT / LIB.get("dir", "library")
PRIMITIVES = set(LIB.get("primitives", []))
RAW_VALUE = re.compile(r"^\s*(#[0-9a-fA-F]{3,8}|rgba?\()")
RAW_IN_CODE = re.compile(r"""['"`](#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})['"`]""")
# A tree is a copy of a shared part when it has this share of the part's ids.
COPY_SHARE = 0.6


def files(patterns):
    seen = []
    for pattern in patterns:
        for path in sorted(ROOT.glob(pattern)):
            if path.is_file() and path not in seen:
                seen.append(path)
    return seen


def screen_files():
    """{file from the project's top: screen id}, from screens.json's "file"s."""
    out = {}
    for sid, meta in (read_json(SCREENS, {"screens": {}}).get("screens") or {}).items():
        if meta.get("file"):
            out[Path(meta["file"]).as_posix()] = sid
    return out


def entries():
    out = []
    for path in sorted(DIR.glob("*.json")) if DIR.is_dir() else []:
        entry = read_json(path, {})
        entry.setdefault("id", path.stem)
        entry["_file"] = rel(path)
        out.append(entry)
    return out


def names_of(entry):
    """The names the app draws the entry by: each implementation's renderer,
    part or widget."""
    names = []
    for impl in (entry.get("implementations") or {}).values():
        for key in ("renderer", "part", "widget"):
            if isinstance(impl, dict) and impl.get(key) and impl[key] not in names:
                names.append(impl[key])
    return names


def ids_in(node):
    out = set()
    if isinstance(node, dict):
        if isinstance(node.get("id"), str):
            out.add(node["id"])
        for v in node.values():
            out |= ids_in(v)
    elif isinstance(node, list):
        for v in node:
            out |= ids_in(v)
    return out


def components_in(node, keys):
    out = Counter()
    if isinstance(node, dict):
        for k in (keys["component"], keys["use"]):
            if isinstance(node.get(k), str):
                out[node[k]] += 1
        for v in node.values():
            out += components_in(v, keys)
    elif isinstance(node, list):
        for v in node:
            out += components_in(v, keys)
    return out


def differs(local, main, keys):
    """What a copy or override holds that its part doesn't, and the reverse,
    or None when they hold the same components."""
    a, b = components_in(local, keys), components_in(main, keys)
    adds, drops = dict(a - b), dict(b - a)
    return {"adds": adds, "drops": drops} if adds or drops else None


class Scan:
    def __init__(self):
        self.uses = []  # {name, kind, file, where, node, line?, part?, differs?}
        self.parts = {}  # shared part name: {file, tree, ids}
        self.raw = Counter()  # file: raw colours
        self.nodes = defaultdict(list)  # name: [(where, node)], the nodes that place it, for specimens
        self.raw_sample = {}
        self.raw_values = Counter()  # each raw colour, by value

    def use(self, **use):
        self.uses.append({k: v for k, v in use.items() if v is not None})

    def raw_value(self, file, value):
        self.raw[file] += 1
        self.raw_values[value.lower()] += 1
        self.raw_sample.setdefault(file, value)

    # ---- JSON node trees

    def json(self, spec, screens):
        keys = {"component": "component", "use": "use", "own": "fragments", **spec.get("keys", {})}
        for path in files(spec.get("parts", [])):
            doc = read_json(path, {})
            for name, tree in doc.items():
                if name.startswith("$") or not isinstance(tree, (dict, list)):
                    continue
                self.parts[name] = {"file": rel(path), "tree": tree, "ids": ids_in(tree)}
                self.walk(tree, keys, rel(path), f"part {name}", {}, part=f"part {name}")
        for path in files(spec.get("files", [])):
            doc = read_json(path, {})
            file = rel(path)
            where = screens.get(file, file)
            own = (doc.get(keys["own"]) if isinstance(doc, dict) else None) or {}
            for name, tree in own.items():
                self.walk(tree, keys, file, where, {}, part=f"{where}'s own {name}")
            body = {k: v for k, v in doc.items() if k != keys["own"]} if isinstance(doc, dict) else doc
            self.walk(body, keys, file, where, own)

    def walk(self, node, keys, file, where, own, part=None):
        if isinstance(node, list):
            for v in node:
                self.walk(v, keys, file, where, own, part)
            return
        if not isinstance(node, dict):
            return
        nid = node.get("id") if isinstance(node.get("id"), str) else None
        comp, placed = node.get(keys["component"]), node.get(keys["use"])
        if isinstance(comp, str):
            self.use(name=comp, kind="instance", file=file, where=where, node=nid, part=part)
            self.keep(comp, where, node)
        if isinstance(placed, str):
            if placed in own:
                main = self.parts.get(placed)
                self.use(name=placed, kind="override", file=file, where=where, node=nid, part=part,
                         differs=differs(own[placed], main["tree"], keys) if main else None)
                if isinstance(own[placed], dict):
                    self.keep(placed, where, {**own[placed], "$own": True})
            else:
                self.use(name=placed, kind="instance", file=file, where=where, node=nid, part=part)
                self.keep(placed, where, node)
        elif part is None and nid and node.get("children"):
            copied = self.copy_of(node)
            if copied:
                self.use(name=copied, kind="copy", file=file, where=where, node=nid,
                         differs=differs(node, self.parts[copied]["tree"], keys))
                return
        for k, v in node.items():
            if k == "props" and isinstance(v, dict):
                for pv in v.values():
                    if isinstance(pv, str) and RAW_VALUE.match(pv):
                        self.raw_value(file, pv.strip())
            if isinstance(v, (dict, list)):
                self.walk(v, keys, file, where, own, part)

    def keep(self, name, where, node):
        if len(self.nodes[name]) < 400:
            self.nodes[name].append((where, node))

    def copy_of(self, node):
        """The shared part this tree copies, if any."""
        mine = ids_in(node)
        best, share = None, COPY_SHARE
        for name, p in self.parts.items():
            if len(p["ids"]) < 3:
                continue
            s = len(mine & p["ids"]) / len(p["ids"])
            if s >= share:
                best, share = name, s
        return best

    # ---- Source code, by pattern

    def code(self, spec):
        pattern = re.compile(spec["pattern"])
        for path in files(spec.get("files", [])):
            text = path.read_text(errors="replace")
            file = rel(path)
            for m in pattern.finditer(text):
                line = text.count("\n", 0, m.start()) + 1
                self.use(name=m.group("name"), kind="instance", file=file, where=file, line=line)
            for m in RAW_IN_CODE.finditer(text):
                self.raw_value(file, m.group(1))


def screens_of(name, uses, seen=()):
    """The screens (or files) a component shows on: where it's used outside
    shared parts, plus, for a use inside a part, wherever that part shows."""
    out = set()
    for u in uses.get(name, []):
        if u["kind"] not in ("instance", "override", "copy"):
            continue
        p = u.get("part", "")
        if p.startswith("part "):
            inner = p[5:]
            if inner not in seen:
                out |= screens_of(inner, uses, seen + (inner,))
        else:
            out.add(u["where"])
    return out


# Each component's picture, taken in the playground when it's on show
# (serve.py keeps them; git ignores them).
PICTURES = HERE / "thumbs" / "_library"


def pictures():
    """{component id: {"at": when it was taken (ms), "screen": where}}."""
    if not PICTURES.is_dir():
        return {}
    where = read_json(PICTURES / "where.json", {})
    return {p.stem: {"at": int(p.stat().st_mtime * 1000), "screen": where.get(p.stem, "")} for p in PICTURES.glob("*.png")}


# The different ways the app sets a component up, to draw side by side.
SPECIMENS = 12


def size_of(node):
    f = node.get("frame") if isinstance(node, dict) else None
    if isinstance(f, list) and len(f) == 4 and all(isinstance(v, (int, float)) for v in f[2:]) and f[2] > 0 and f[3] > 0:
        return [f[2], f[3]]
    return None


def specimens(names, scan, parts, states=()):
    """A component's specimens: its entry's named states, then up to SPECIMENS
    distinct set-ups from its real uses, each {name?, where?, node, size}."""
    out = []
    renderer = next((n for n in names if n not in parts), None)
    part = next((n for n in names if n in parts), None)
    for st in states or []:
        size = st.get("size")
        if not (isinstance(size, list) and len(size) == 2):
            continue
        node = ({"component": renderer, "props": st.get("props", {})} if renderer
                else {"use": part, "with": st.get("props", {})} if part else None)
        if node:
            out.append({"name": st.get("name", ""), "node": {**node, "id": f"state-{len(out)}", "frame": [0, 0, *size]}, "size": size})
    # Distinct set-ups, taken in turn from each place it's used (screens
    # before shared parts), so they show its range rather than one screen's.
    seen, by_where = set(), defaultdict(list)
    for n in names:
        for where, node in scan.nodes.get(n, []):
            size = size_of(node) or (size_of(parts[n]["tree"]) if n in parts else None)
            if not size:
                continue
            own = node.get("$own", False)
            look = json.dumps([node.get("props"), node.get("with"), size, own and where], sort_keys=True, default=str)
            if look in seen:
                continue
            seen.add(look)
            clean = {k: v for k, v in node.items() if k != "$own"}
            by_where[where].append({"where": where, "id": node.get("id"), "own": own or None,
                                    "node": {**clean, "frame": [0, 0, *size]}, "size": size})
    queues = [by_where[w] for w in sorted(by_where, key=lambda w: (w.startswith("part "), w))]
    limit = SPECIMENS + len(out)
    while len(out) < limit and any(queues):
        for q in queues:
            if q and len(out) < limit:
                out.append({k: v for k, v in q.pop(0).items() if v is not None})
    return out


# The page shows at most this many single uses of a component; the counts
# always cover them all.
MAX_USES = 200


def roots(tree):
    """A shared part's top node ids, which is how the app marks where it is."""
    nodes = tree if isinstance(tree, list) else [tree]
    return [n["id"] for n in nodes if isinstance(n, dict) and isinstance(n.get("id"), str)]


def item(names, by_name, parts, looks=(), scan=None, states=()):
    """One component's uses, counted, as the page and the table show them."""
    uses = [u for n in names for u in by_name.get(n, [])]
    kinds = Counter(u["kind"] for u in uses)
    every = uses + [dict(u, kind="look-alike") for n in looks for u in by_name[n]]
    # What's out of step first, so it survives the cap.
    every.sort(key=lambda u: (u["kind"] == "instance" and not u.get("differs"), u["file"]))
    return {
        "names": names,
        "main": [{"part": n, "file": parts[n]["file"], "roots": roots(parts[n]["tree"])} for n in names if n in parts],
        "counts": {"uses": len(uses), "instances": kinds["instance"], "overrides": kinds["override"], "copies": kinds["copy"],
                   "differ": sum(1 for u in uses if u.get("differs")),
                   "byFile": dict(Counter(u["file"] for u in uses).most_common())},
        "byWhere": dict(Counter(u["where"] for u in uses).most_common()),
        "screens": sorted(set().union(*(screens_of(n, by_name) for n in names)) if names else set()),
        "lookalikes": [{"name": n, "uses": len(by_name[n])} for n in looks],
        "lookScreens": sorted(set().union(*(screens_of(n, by_name) for n in looks)) if looks else set()),
        "uses": every[:MAX_USES],
        "specimens": specimens(names, scan, parts, states) if scan else [],
        "usesTotal": len(every),
    }


def scan_app():
    scan, screens = Scan(), screen_files()
    for spec in LIB.get("scan", []):
        if spec.get("kind", "json") == "json":
            scan.json(spec, screens)
        else:
            scan.code(spec)
    return scan, screens


def proposals():
    """Every component a version proposes: its entry in the version's library/."""
    from pglib import DATA
    out = []
    for path in sorted(DATA.glob("*/v*/library/*.json")):
        entry = read_json(path, {})
        if not isinstance(entry, dict):
            continue
        pg, vid = path.parent.parent.parent.name, path.parent.parent.name
        out.append({"id": entry.get("id", path.stem), "name": entry.get("name", path.stem),
                    "for": (entry.get("purpose") or {}).get("for"), "names": names_of(entry),
                    "version": f"{pg}/{vid}", "file": rel(path), "entry": entry})
    return out


def library():
    scan, screens = scan_app()

    by_name = defaultdict(list)
    for u in scan.uses:
        by_name[u["name"]].append(u)

    shots = pictures()
    listed, out = set(), {"configured": bool(LIB), "dir": rel(DIR) if DIR.exists() else LIB.get("dir", "library"),
                          "screens": sorted(set(screens.values())), "entries": []}
    for entry in entries():
        names = names_of(entry)
        listed |= set(names)
        patterns = entry.get("lookalikes", [])
        looks = sorted({n for n in by_name if n not in names and any(fnmatch.fnmatchcase(n, p) for p in patterns)})
        listed |= set(looks)
        out["entries"].append({
            "id": entry["id"], "name": entry.get("name", entry["id"]), "status": entry.get("status", "draft"),
            "file": entry["_file"], "for": (entry.get("purpose") or {}).get("for"),
            "entry": {k: v for k, v in entry.items() if not k.startswith("_")},
            **item(names, by_name, scan.parts, looks, scan, entry.get("states")),
            "picture": shots.get(entry["id"]),
        })

    out["unlisted"] = sorted(
        ({"id": n, "name": n, "kind": "part" if n in scan.parts else "renderer", **item([n], by_name, scan.parts, (), scan), "picture": shots.get(n)}
         for n in by_name if n not in listed and n not in PRIMITIVES),
        key=lambda x: -x["counts"]["uses"])
    out["primitives"] = {n: len(by_name[n]) for n in sorted(PRIMITIVES) if n in by_name}
    out["proposed"] = proposals()
    out["raw"] = [{"file": f, "count": c, "sample": scan.raw_sample[f]} for f, c in scan.raw.most_common()]
    return out


CODE_SUFFIXES = (".js", ".mjs", ".jsx", ".ts", ".tsx", ".dart", ".vue", ".svelte")


def scan_folder(folder, parts, screen_ids=()):
    """The components, raw colours and copies in a version's own files (or one
    file), as a Scan, with the app's shared parts to find copies of."""
    scan = Scan()
    scan.parts = parts
    keys = {"component": "component", "use": "use", "own": "fragments"}
    for spec in LIB.get("scan", []):
        if spec.get("kind", "json") == "json":
            keys.update(spec.get("keys", {}))
    paths = [folder] if folder.is_file() else [p for p in sorted(folder.rglob("*")) if p.is_file() and "library" not in p.relative_to(folder).parts]
    codes = [re.compile(spec["pattern"]) for spec in LIB.get("scan", []) if spec.get("kind") == "code" and spec.get("pattern")]
    defines = define_patterns()
    defined = set()
    for path in paths:
        file = rel(path)
        if path.suffix == ".json" and path.name != "versions.json":
            doc = read_json(path, None)
            if doc is None:
                continue
            own = (doc.get(keys["own"]) if isinstance(doc, dict) else None) or {}
            for name, tree in own.items():
                scan.walk(tree, keys, file, file, {}, part=f"own {name}")
            body = {k: v for k, v in doc.items() if k != keys["own"]} if isinstance(doc, dict) else doc
            scan.walk(body, keys, file, file, own)
        elif path.suffix in CODE_SUFFIXES:
            text = path.read_text(errors="replace")
            for pattern in codes:
                for m in pattern.finditer(text):
                    scan.use(name=m.group("name"), kind="instance", file=file, where=file)
            for d in defines:
                defined |= {m.group("name") for m in d.finditer(text)}
            for m in RAW_IN_CODE.finditer(text):
                scan.raw_value(file, m.group(1))
    scan.defined = defined
    return scan


def define_patterns():
    d = LIB.get("define") or {}
    pats = [d] if isinstance(d, str) else d.get("patterns", [])
    return [re.compile(p, re.M) for p in pats]


def app_defined():
    """Every renderer the app's own code defines ("define" in "library")."""
    d = LIB.get("define") or {}
    found = set()
    for path in files(d.get("files", []) if isinstance(d, dict) else []):
        text = path.read_text(errors="replace")
        for pattern in define_patterns():
            found |= {m.group("name") for m in pattern.finditer(text)}
    return found


def check(pg, which):
    """What a version brings in that's out of step with the library, against
    main: {version, findings: [{kind, name, text}], proposed: [...]}."""
    from pglib import DATA, find_version, read_json as rj, screens as app_screens
    meta = rj(DATA / pg / "versions.json", None)
    if not meta:
        raise ValueError(f"No explorations called {pg!r}.")
    vid = find_version(meta, pg, which)
    if vid == "default":
        raise ValueError("main is the app as it is: there's nothing to check it against.")
    folder = DATA / pg / vid
    app, _ = scan_app()
    app_names = app_defined()
    by_name = defaultdict(list)
    for u in app.uses:
        by_name[u["name"]].append(u)
    lib_entries = entries()
    mine = [p for p in proposals() if p["version"] == f"{pg}/{vid}"]
    listed = {n for e in lib_entries for n in names_of(e)} | {n for p in proposals() for n in p["names"]}
    looks = {}
    for e in lib_entries:
        for pat in e.get("lookalikes", []):
            looks[pat] = e
    # The baseline: the screen as main has it (a component exploration has none).
    main_file = (app_screens().get(meta.get("start") or pg, {}) if not meta.get("component") else {}).get("file")
    base = scan_folder(ROOT / main_file, app.parts) if main_file and (ROOT / main_file).is_file() else Scan()
    if not hasattr(base, "defined"):
        base.defined = set()
    ver = scan_folder(folder, app.parts)
    count = lambda sc, kind: Counter(u["name"] for u in sc.uses if u["kind"] == kind)
    added = (count(ver, "instance") - count(base, "instance")) + Counter(ver.defined - base.defined)
    findings = []
    for name in sorted(added):
        if name in PRIMITIVES:
            continue
        entry = next((e for pat, e in looks.items() if fnmatch.fnmatchcase(name, pat) and name not in names_of(e)), None)
        if entry:
            findings.append({"kind": "look-alike", "name": name,
                             "text": f"{name} looks like {entry.get('name', entry['id'])}: draw it with {', '.join(names_of(entry)) or 'that'} instead."})
        elif name not in by_name and name not in listed and name not in app_names:
            findings.append({"kind": "new", "name": name,
                             "text": f"{name} is new and has no entry: use a component the library has, or propose it in {rel(folder)}/library/<id>.json."})
    for name, n in sorted((count(ver, "copy") - count(base, "copy")).items()):
        findings.append({"kind": "copy", "name": name, "text": f"{n} cop{'y' if n == 1 else 'ies'} of the shared part {name}: place it with use instead."})
    known_raw = set(app.raw_values)
    new_raw = {v: c for v, c in (ver.raw_values - base.raw_values).items() if v not in known_raw}
    if new_raw:
        findings.append({"kind": "raw", "name": None,
                         "text": f"Colours not from a token: {', '.join(f'{v} ({c}×)' if c > 1 else v for v, c in sorted(new_raw.items()))}. Use the project's tokens."})
    return {"version": f"{pg}/{vid}", "findings": findings,
            "proposed": [{"id": p["id"], "name": p["name"], "file": p["file"]} for p in mine]}


def brief(lib):
    """What to design with, short: for Claude, before it builds."""
    lines = [f"The library ({lib['dir']}/, entries by status; python3 playground/library.py has every use):"]
    for e in sorted(lib["entries"], key=lambda e: ["approved", "pending", "draft"].index(e["status"]) if e["status"] in ("approved", "pending", "draft") else 3):
        c = e["counts"]
        lines.append(f"- {e['name']} [{e['status']}] ({e['file']}), drawn by {', '.join(e['names']) or 'nothing yet'}; "
                     f"{c['uses']} uses on {len(e['screens'])} screens. {e.get('for') or ''}")
        for look in e["lookalikes"]:
            lines.append(f"  - look-alike to replace, not copy: {look['name']}")
    if lib.get("proposed"):
        lines.append("Proposed by versions (not in the library yet):")
        for p in lib["proposed"]:
            lines.append(f"- {p['name']} ({p['file']}), from {p['version']}. {p.get('for') or ''}")
    top = lib["unlisted"][:15]
    if top:
        lines.append("Drawn without an entry yet (most used first; reuse these rather than drawing a new one):")
        lines.append("  " + ", ".join(f"{u['name']} ({u['counts']['uses']})" for u in top))
    if lib["primitives"]:
        lines.append("Primitives: " + ", ".join(lib["primitives"]))
    return "\n".join(lines)


def table(lib):
    lines = []
    if not lib["configured"]:
        lines.append('No "library" in playground.json, so nothing was scanned. Its docstring says how to add one.')
    lines.append(f"Library: {len(lib['entries'])} components with an entry in {lib['dir']}/")
    for e in lib["entries"]:
        c = e["counts"]
        extra = [f"{c['overrides']} overrides" if c["overrides"] else "", f"{c['copies']} copies" if c["copies"] else "",
                 f"{c['differ']} differ from main" if c["differ"] else ""]
        lines.append(f"  {e['name']} ({e['status']}, drawn by {', '.join(e['names']) or 'nothing yet'}): "
                     f"{c['instances']} instances, on {len(e['screens'])} screens or files"
                     + "".join(f", {x}" for x in extra if x))
        lines.append("    in " + ", ".join(f"{f} ({n})" for f, n in c["byFile"].items()))
        lines.append("    on " + (", ".join(e["screens"]) or "nothing yet"))
        for look in e["lookalikes"]:
            lines.append(f"    look-alike: {look['name']}, {look['uses']} uses")
        for u in e["uses"]:
            if u["kind"] in ("override", "copy") or u.get("differs"):
                d = u.get("differs")
                diff = (f": has {', '.join(f'{k} ×{v}' for k, v in d['adds'].items()) or 'nothing more'}"
                        f" instead of {', '.join(f'{k} ×{v}' for k, v in d['drops'].items()) or 'nothing'}") if d else ""
                lines.append(f"    {u['kind']} on {u['where']} ({u['file']}{', node ' + u['node'] if u.get('node') else ''}){diff}")
    if lib["unlisted"]:
        lines.append(f"No entry yet: {len(lib['unlisted'])}")
        for u in lib["unlisted"]:
            lines.append(f"  {u['name']} ({u['kind']}): {u['counts']['uses']} uses")
    if lib["primitives"]:
        lines.append("Primitives: " + ", ".join(f"{n} {c}" for n, c in lib["primitives"].items()))
    if lib["raw"]:
        lines.append(f"Raw colours: {sum(r['count'] for r in lib['raw'])} in {len(lib['raw'])} files")
        for r in lib["raw"]:
            lines.append(f"  {r['file']}: {r['count']} (e.g. {r['sample']})")
    return "\n".join(lines)


def main(argv):
    if "--check" in argv:
        i = argv.index("--check")
        if len(argv) < i + 3:
            sys.exit(__doc__)
        try:
            result = check(argv[i + 1], argv[i + 2])
        except ValueError as e:
            sys.exit(str(e))
        if "--json" in argv:
            print(json.dumps(result, ensure_ascii=False, indent=1))
        else:
            print(f"Library check of {result['version']}: " + ("nothing out of step." if not result["findings"] else f"{len(result['findings'])} out of step."))
            for f in result["findings"]:
                print(f"- {f['text']}")
            for p in result["proposed"]:
                print(f"- Proposes {p['name']} ({p['file']}).")
        return 0
    lib = library()
    print(json.dumps(lib, ensure_ascii=False, indent=1) if "--json" in argv else brief(lib) if "--brief" in argv else table(lib))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
