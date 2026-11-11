"""The project's design system, for the canvas's Properties (src/design.js).

A project names its design system in playground.json:

    "system": {
      "name": "…",
      "tokens": "path/to/tokens.json",       from the project's top
      "modes": {"<collection>": "<mode>"},   the modes this project is drawn in
      "grid": 4,                             every size a multiple of it
      "scales": [
        {"key": "type",   "collection": "…", "match": "^(\\w+)/Size$"},
        {"key": "weight", "collection": "…", "match": "^XS/Font Weight (\\w+)$", "map": {"basic": 400}},
        {"key": "radius", "collection": "…", "match": "…", "names": {"<name>": "<label>"}},
        {"key": "space",  "collection": "…", "match": "…", "onGrid": true},
        {"key": "color",  "collection": "…", "type": "COLOR"}
      ]
    }

The tokens file is a Figma variables export: collections by name, each with
its tokens by name, each with a value per mode, raw or {"ref":
"<collection>.<token>"}. A value is resolved in the mode playground.json
gives its collection (else the collection's default mode), following each
reference into its own collection the same way.

Each scale is the tokens that match, each with its name (the pattern's first
group, else the token's last segment) and its value, smallest first. The
dials in Properties offer only these values: the system is the only source.
The playground only reads the system; it never writes to it.

Changes made with the dials are saved in the iteration they're made on, in
its folder's design.json (save()): each a selector (what it changes: one
part by its node id, or every use of a component), what the dials say
(type size 26, padding top 8) and the style properties they set. The app's
bridge lays each running version's design.json over the app, so the frame,
its frozen copy and the classic playground all show it. On Main, the first
change starts a new exploration of the page on show that changes nothing in
code (its version file draws nothing of its own, so it's main exactly), and
is saved there: main itself only changes by Commit, which carries a version's
design.json into the app's own source.

Standard library only.
"""
import json
import re
import time

from pglib import ADAPTER, CONFIG, DATA, ROOT, VERSION_FILE, add_to_canvas, number, playground_lock, playgrounds, read_json, screen_meta, screens, write_json, write_registry

DESIGN = "design.json"
VERSION = re.compile(r"^v\d+\.\d+$")

_cache = {}


def config():
    return CONFIG.get("system") or None


def load():
    """The system's scales, or None when the project names none."""
    cfg = config()
    if not cfg:
        return None
    path = (ROOT / cfg["tokens"]).resolve()
    try:
        stamp = (path, path.stat().st_mtime)
    except OSError as e:
        return {"name": cfg.get("name"), "error": f"Can't read {cfg['tokens']}: {e.strerror}"}
    if _cache.get("stamp") == stamp:
        return _cache["out"]
    data = json.loads(path.read_text())
    cols = data.get("collections", {})
    modes = cfg.get("modes", {})

    def resolve(col, name, depth=0):
        c = cols.get(col)
        t = c and c.get("tokens", {}).get(name)
        if not t or depth > 12:
            return None
        values = t.get("values", {})
        mode = modes.get(col) or c.get("default_mode")
        v = values.get(mode, next(iter(values.values()), None))
        if isinstance(v, dict) and "ref" in v:
            to, _, tname = v["ref"].partition(".")
            return resolve(to, tname, depth + 1)
        return v

    scales = {}
    for s in cfg.get("scales", []):
        col = cols.get(s.get("collection"), {})
        pat = re.compile(s["match"]) if s.get("match") else None
        out = []
        for name, t in col.get("tokens", {}).items():
            if s.get("type") and t.get("type") != s["type"]:
                continue
            m = pat.search(name) if pat else None
            if pat and not m:
                continue
            value = resolve(s["collection"], name)
            if value is None:
                continue
            if "map" in s:
                value = s["map"].get(str(value), value)
            label = (m.group(1) if m and m.groups() and m.group(1) else name.rsplit("/", 1)[-1])
            label = s.get("names", {}).get(label, label)
            out.append({"name": label, "token": f"{s['collection']}/{name}", "value": value})
        if out and all(isinstance(x["value"], (int, float)) for x in out):
            out.sort(key=lambda x: x["value"])
        if s.get("onGrid") and cfg.get("grid"):  # only the steps on the project's grid
            out = [x for x in out if isinstance(x["value"], (int, float)) and x["value"] % cfg["grid"] == 0]
        scales[s["key"]] = out
    result = {"name": cfg.get("name") or "The design system", "grid": cfg.get("grid"),
              "modes": modes, "scales": scales}
    _cache.update(stamp=stamp, out=result)
    return result


def styles(pg, version):
    """The dial changes saved in a version: [{sel, label, dials, props}]."""
    if pg not in playgrounds() or not VERSION.match(str(version)):
        return []
    return read_json(DATA / pg / version / DESIGN, {}).get("styles", [])


def save(body):
    """Saves one part's dial changes in a version (body: playground, version,
    sel, label, dials {name: value}, props {css property: value}; empty
    dials remove the part's changes). With no playground (Main), a new
    exploration of body["screen"] is made first and put on the canvas.
    Returns {playground, version, made, styles}."""
    pg, version, made = body.get("playground"), body.get("version"), False
    sel = str(body.get("sel") or "")
    if not sel or len(sel) > 500:
        raise ValueError("No part to change.")
    if not pg:
        screen = str(body.get("screen") or "")
        if screen not in screens():
            raise ValueError(f"{screen or 'That page'} isn't one of the app's screens, so it can't be explored.")
        if ADAPTER != "web":
            raise ValueError("The Design dials work with web apps only.")
        name = str(body.get("name") or "Design dials")[:80]
        with playground_lock():
            meta_path, meta = screen_meta(screen)
            n = 1 + max([number(v["id"])[0] for v in meta["versions"] if number(v["id"])] or [0])
            version = f"v{n}.0"
            folder = DATA / screen / version
            folder.mkdir(parents=True)
            (folder / VERSION_FILE).write_text(
                f"// {meta.get('title', screen)}: {name} ({version}). It changes nothing in code, so it's main\n"
                "// exactly; what it changes is in design.json, set with the canvas's Design dials, which\n"
                "// the playground's bridge lays over the app.\n\nexport default { pages: {} };\n")
            meta["versions"].append({"id": version, "name": name, "date": time.strftime("%Y-%m-%d"),
                                     "note": "Changed with the canvas's Design dials: each change is in design.json."})
            write_json(meta_path, meta)
            write_registry()
            try:
                import frozen
                frozen.freeze(f"{screen}/{version}")  # its base: main as it is now
            except Exception as e:
                print(f"(The canvas's frozen copy of {screen} {version} wasn't made: {e})")
        pg, made = screen, True
        add_to_canvas([(pg, version)])
    if pg not in playgrounds() or not VERSION.match(str(version)) or not (DATA / pg / version).is_dir():
        raise ValueError(f"{pg} {version} isn't a version.")
    path = DATA / pg / version / DESIGN
    doc = read_json(path, {})
    doc.setdefault("$comment", "Changes made with the canvas's Design dials (playground/system.py). The playground's "
                   "bridge sets each one's style props on what its selector matches, over this version. "
                   "Commit carries them into the app's own source.")
    kept = [e for e in doc.get("styles", []) if e.get("sel") != sel]
    dials = {k: v for k, v in (body.get("dials") or {}).items() if v is not None}
    props = {k: str(v) for k, v in (body.get("props") or {}).items() if v is not None}
    if dials:
        kept.append({"sel": sel, "label": str(body.get("label") or sel)[:120], "dials": dials, "props": props,
                     "at": time.strftime("%Y-%m-%dT%H:%M:%S")})
    if kept:
        doc["styles"] = kept
        write_json(path, doc)
    else:
        path.unlink(missing_ok=True)  # no changes left: no file
    return {"playground": pg, "version": version, "made": made, "styles": kept}
