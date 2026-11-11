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

Standard library only.
"""
import json
import re

from pglib import CONFIG, ROOT

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
